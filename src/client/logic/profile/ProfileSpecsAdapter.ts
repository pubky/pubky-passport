import "client-only";

import { Result, type Result as ResultType } from "better-result";
import type { PubkyAppFile, PubkyAppUser, PubkySpecsBuilder } from "pubky-app-specs";
import SPECS_LIMITS from "pubky-app-specs/validationLimits.json";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import type { PreparedAvatar, ProfilePublication, ProfileWrite, PubkyProfile } from "./profile";

/**
 * The only module that imports `pubky-app-specs`, mirroring how the Pubky SDK is confined to
 * `PubkySdkAdapter`. Documents are validated and serialised by the specs WASM, never by a
 * TypeScript copy of the schema. The WASM loads on first use; the limits file is WASM-free.
 */

/** Limits of the pinned specs release, for form hints only; the WASM remains the validator. */
export const PROFILE_LIMITS = {
  nameMinLength: SPECS_LIMITS.userNameMinLength,
  nameMaxLength: SPECS_LIMITS.userNameMaxLength,
  bioMaxLength: SPECS_LIMITS.userBioMaxLength,
  linksMaxCount: SPECS_LIMITS.userLinksMaxCount,
} as const;

export type ProfileSpecsErrorCode =
  "invalid_avatar" | "invalid_file_record" | "invalid_profile" | "specs_unavailable";
export type ProfileSpecsResult<T> = ResultType<T, CodedFailure<ProfileSpecsErrorCode>>;
type ProfileSpecsOperation = "build_publication" | "parse_file_record" | "parse_profile";
type Specs = typeof import("pubky-app-specs");

async function loadSpecs(operation: ProfileSpecsOperation): Promise<ProfileSpecsResult<Specs>> {
  try {
    return Result.ok(await import("pubky-app-specs"));
  } catch (e) {
    return failure(operation, "specs_unavailable", e);
  }
}

/** Sanitises and validates a `profile.json` body read from a homeserver. */
export async function parseProfile(json: unknown): Promise<ProfileSpecsResult<PubkyProfile>> {
  const specs = await loadSpecs("parse_profile");
  if (Result.isError(specs)) return specs;
  let user: PubkyAppUser | undefined;
  try {
    user = specs.value.PubkyAppUser.fromJson(json);
    return Result.ok(user.toJson() as PubkyProfile);
  } catch (e) {
    return failure("parse_profile", "invalid_profile", e);
  } finally {
    user?.free();
  }
}

/** Validates a `pubky-app-specs` file record and returns the blob it points at. */
export async function parseFileRecordSource(json: unknown): Promise<ProfileSpecsResult<string>> {
  const specs = await loadSpecs("parse_file_record");
  if (Result.isError(specs)) return specs;
  let file: PubkyAppFile | undefined;
  try {
    file = specs.value.PubkyAppFile.fromJson(json);
    return Result.ok(file.src);
  } catch (e) {
    return failure("parse_file_record", "invalid_file_record", e);
  } finally {
    file?.free();
  }
}

/**
 * Builds the canonical writes for a profile: the avatar blob, its file record, then
 * `profile.json`, so the profile never points at an avatar that was not written.
 */
export async function buildProfilePublication(
  publicKey: string,
  profile: PubkyProfile,
  avatar?: PreparedAvatar,
): Promise<ProfileSpecsResult<ProfilePublication>> {
  const specs = await loadSpecs("build_publication");
  if (Result.isError(specs)) return specs;
  let builder: PubkySpecsBuilder;
  try {
    builder = new specs.value.PubkySpecsBuilder(publicKey);
  } catch (e) {
    return failure("build_publication", "invalid_profile", e);
  }
  const resources: { free: () => void }[] = [builder];
  try {
    const writes: ProfileWrite[] = [];
    let image = profile.image ?? null;
    if (avatar) {
      try {
        const blob = builder.createBlob(avatar.bytes);
        resources.push(blob);
        const blobMeta = blob.meta;
        resources.push(blobMeta);
        const file = builder.createFile(
          avatar.name,
          blobMeta.url,
          avatar.contentType,
          avatar.bytes.byteLength,
        );
        resources.push(file);
        const fileMeta = file.meta;
        const record = file.file;
        resources.push(fileMeta, record);
        writes.push(
          { kind: "bytes", path: blobMeta.path, bytes: avatar.bytes },
          { kind: "json", path: fileMeta.path, json: record.toJson() },
        );
        image = fileMeta.url;
      } catch (e) {
        return failure("build_publication", "invalid_avatar", e);
      }
    }
    const result = builder.createUser(
      profile.name,
      profile.bio ?? null,
      image,
      profile.links ?? null,
      profile.status ?? null,
    );
    resources.push(result);
    const user = result.user;
    const meta = result.meta;
    resources.push(user, meta);
    const document = user.toJson() as PubkyProfile;
    writes.push({ kind: "json", path: meta.path, json: document });
    return Result.ok({ profile: document, writes });
  } catch (e) {
    return failure("build_publication", "invalid_profile", e);
  } finally {
    for (const resource of resources.reverse()) {
      try {
        resource.free();
      } catch (e) {
        LOGGER.warn("profile.specs.cleanup.failed", {
          operation: "build_publication",
          ...safeErrorLogFields(e),
        });
      }
    }
  }
}

function failure<Success>(
  operation: ProfileSpecsOperation,
  code: ProfileSpecsErrorCode,
  cause: unknown,
): ProfileSpecsResult<Success> {
  // Specs errors are plain strings that can quote document content; only the code is logged.
  LOGGER.warn("profile.specs.failed", { operation, code, ...safeErrorLogFields(cause) });
  return Result.err({ code, cause });
}
