import "client-only";
import { Result, type Result as ResultType } from "better-result";
import type { CodedFailure } from "@/libs/result";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { LocalStorageIdentityRepository } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import { isPubkyPublicKey } from "@/client/logic/pubky/pubkyIdentityKey";
import { avatarThumbnail, prepareAvatar } from "./avatarImage";
import {
  PROFILE_PATH,
  ownAvatarResource,
  type LoadedProfile,
  type PreparedAvatar,
  type ProfilePublication,
  type PubkyProfile,
} from "./profile";
import {
  buildProfilePublication,
  parseFileRecordSource,
  parseProfile,
  type ProfileSpecsErrorCode,
} from "./ProfileSpecsAdapter";
import type { PubkyProfileTransport } from "../pubky/PubkySdkAdapter";

export type ProfileErrorCode =
  | "cancelled"
  | "disconnected"
  | "identity_unavailable"
  | "invalid_avatar"
  | "invalid_profile"
  | "load_failed"
  | "save_failed"
  | "storage_failed";
export type ProfileResult<T> = ResultType<T, CodedFailure<ProfileErrorCode>>;
type ProfileTransport = Pick<PubkyProfileTransport, "readImage" | "readJson" | "writeProfile">;

/**
 * Validates, re-encodes and serialises a profile before any session or grant is used, so a save
 * that can only fail never signs in.
 */
export async function prepareProfilePublication(
  publicKey: string,
  input: PubkyProfile,
  avatar?: File,
): Promise<ProfileResult<ProfilePublication>> {
  let prepared: PreparedAvatar | undefined;
  if (avatar) {
    const result = await prepareAvatar(avatar);
    if (Result.isError(result)) return Result.err({ code: "invalid_avatar", cause: result.error });
    prepared = result.value;
  }
  const publication = await buildProfilePublication(publicKey, input, prepared);
  if (Result.isOk(publication)) return Result.ok(publication.value);
  return Result.err({
    code: publicationErrorCode(publication.error.code),
    cause: publication.error,
  });
}

/** A specs chunk that failed to load is retryable, so it must not be reported as invalid input. */
function publicationErrorCode(code: ProfileSpecsErrorCode): ProfileErrorCode {
  switch (code) {
    case "specs_unavailable":
      return "save_failed";
    case "invalid_avatar":
      return "invalid_avatar";
    case "invalid_file_record":
    case "invalid_profile":
      return "invalid_profile";
  }
}

/**
 * Public reads never access local secrets. Writes own a short-lived, identity-bound session. Each
 * read of a saved identity's profile is remembered as its summary (name and a small avatar), so
 * lists can name identities without reading them all.
 */
export class ProfileController {
  constructor(
    private readonly repository: Pick<
      LocalStorageIdentityRepository,
      "read" | "completeProfileSetup" | "rememberProfileSummary"
    > = new LocalStorageIdentityRepository(),
    private readonly transport?: ProfileTransport,
  ) {}

  private async getTransport(): Promise<ResultType<ProfileTransport, unknown>> {
    if (this.transport) return Result.ok(this.transport);
    try {
      const { PubkyProfileTransport } = await import("../pubky/PubkySdkAdapter");
      return Result.ok(new PubkyProfileTransport());
    } catch (e) {
      return Result.err(e);
    }
  }

  async load(publicKey: string): Promise<ProfileResult<LoadedProfile | null>> {
    if (!isPubkyPublicKey(publicKey)) return Result.err({ code: "identity_unavailable" });
    const loaded = await this.getTransport();
    if (Result.isError(loaded)) return Result.err({ code: "load_failed", cause: loaded.error });
    const transport = loaded.value;
    const document = await transport.readJson(`pubky://${publicKey}${PROFILE_PATH}`);
    if (Result.isError(document)) {
      // An unreadable document fails the same way on every retry; a failed read may not.
      const unreadable =
        document.error.code === "invalid_resource" || document.error.code === "resource_too_large";
      return Result.err({
        code: unreadable ? "invalid_profile" : "load_failed",
        cause: document.error,
      });
    }
    if (document.value === null) {
      void this.rememberSummary(publicKey, null);
      return Result.ok(null);
    }
    const profile = await parseProfile(document.value);
    if (Result.isError(profile)) {
      return Result.err({
        code: profile.error.code === "specs_unavailable" ? "load_failed" : "invalid_profile",
        cause: profile.error,
      });
    }
    // A missing or broken avatar must not hide an otherwise valid profile.
    const avatar = profile.value.image
      ? await this.loadAvatar(transport, publicKey, profile.value.image)
      : undefined;
    const loadedProfile = { profile: profile.value, avatar };
    void this.rememberSummary(publicKey, loadedProfile);
    return Result.ok(loadedProfile);
  }

  /** Best effort: a summary that cannot be kept only means a list shows the key alone. */
  private async rememberSummary(publicKey: string, loaded: LoadedProfile | null): Promise<void> {
    try {
      const avatar = loaded?.avatar ? await avatarThumbnail(loaded.avatar) : undefined;
      this.repository.rememberProfileSummary(
        publicKey,
        loaded ? { name: loaded.profile.name, ...(avatar ? { avatar } : {}) } : null,
      );
    } catch (e) {
      LOGGER.info("profile.summary.failed", safeErrorLogFields(e));
    }
  }

  async save(
    publicKey: string,
    input: PubkyProfile,
    avatar?: File,
  ): Promise<ProfileResult<PubkyProfile>> {
    if (!isPubkyPublicKey(publicKey)) return Result.err({ code: "identity_unavailable" });
    const publication = await prepareProfilePublication(publicKey, input, avatar);
    if (Result.isError(publication)) return Result.err(publication.error);
    const stored = this.repository.read(publicKey);
    if (Result.isError(stored)) return Result.err({ code: "identity_unavailable" });
    try {
      const transport = await this.getTransport();
      if (Result.isError(transport)) {
        return Result.err({ code: "save_failed", cause: transport.error });
      }
      const written = await transport.value.writeProfile(
        publicKey,
        stored.value.secretKey.bytes,
        publication.value.writes,
      );
      if (Result.isError(written)) {
        return Result.err({
          code: written.error.code === "identity_mismatch" ? "identity_unavailable" : "save_failed",
          cause: written.error,
        });
      }
      // Never clear onboarding until the homeserver has accepted profile.json.
      const finished = this.repository.completeProfileSetup(publicKey);
      return Result.isError(finished)
        ? Result.err({ code: "storage_failed", cause: finished.error })
        : Result.ok(publication.value.profile);
    } finally {
      stored.value.secretKey.bytes.fill(0);
    }
  }

  /** Each read has its own deadline in the transport; any failure, including a timeout, means no avatar. */
  private async loadAvatar(
    transport: ProfileTransport,
    publicKey: string,
    image: string,
  ): Promise<Blob | undefined> {
    const resource = ownAvatarResource(publicKey, image);
    if (!resource) {
      LOGGER.info("profile.avatar.skipped", { code: "unsupported_address" });
      return undefined;
    }
    let source = image;
    if (resource === "files") {
      const record = await transport.readJson(image);
      if (Result.isError(record) || record.value === null) return undefined;
      const parsed = await parseFileRecordSource(record.value);
      if (Result.isError(parsed)) return undefined;
      if (ownAvatarResource(publicKey, parsed.value) !== "blobs") {
        LOGGER.info("profile.avatar.skipped", { code: "unsupported_address" });
        return undefined;
      }
      source = parsed.value;
    }
    const blob = await transport.readImage(source);
    return Result.isOk(blob) ? blob.value : undefined;
  }
}
