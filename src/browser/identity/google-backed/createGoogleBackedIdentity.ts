import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import { LOGGER } from "../../../libs/logger/logger";
import type { PassportFileReference, PassportFileStoreResult } from "../../passport-file/googleDrivePassportFileStore";
import type { PassportFileEnvelopeV1 } from "../../passport-file/passportFileEnvelope";
import type { EncryptPassportSecret } from "../../passport-file/passportFileWebCrypto";
import type { HomeserverSignupInvitation } from "../../homegate/homegateClient";
import { SaveLocalIdentity } from "../local/saveLocalIdentity";
import type { ReportGoogleBackedIdentityProgress } from "./googleBackedIdentityProgress";

type CreateGoogleBackedIdentityErrorCode =
  | "create_failed"
  | "encrypt_failed"
  | "drive_create_conflict"
  | "drive_write_failed"
  | "signup_failed"
  | "identity_mismatch"
  | "discovery_failed"
  | "local_save_failed";

export type CreateGoogleBackedIdentityError = {
  code: CreateGoogleBackedIdentityErrorCode;
  preservedPassportFileIdentity?: PubkyPublicIdentity;
};

export type CreatedGoogleBackedIdentity = {
  establishmentMode: "created";
  publicIdentity: PubkyPublicIdentity;
};

export type CreateGoogleBackedIdentityResult<T = CreatedGoogleBackedIdentity> = ResultType<
  T,
  CreateGoogleBackedIdentityError
>;

export class CreateGoogleBackedIdentity {
  readonly #encryptSecretKeyBytes: EncryptPassportSecret;
  readonly #pubky: PubkySdkAdapter;
  readonly #saveLocalIdentity: SaveLocalIdentity;
  readonly #passportOrigin: string;

  constructor(input: {
    encryptSecretKeyBytes: EncryptPassportSecret;
    pubky: PubkySdkAdapter;
    saveLocalIdentity: SaveLocalIdentity;
    passportOrigin: string;
  }) {
    this.#encryptSecretKeyBytes = input.encryptSecretKeyBytes;
    this.#pubky = input.pubky;
    this.#saveLocalIdentity = input.saveLocalIdentity;
    this.#passportOrigin = input.passportOrigin;
  }

  async execute(
    invitation: HomeserverSignupInvitation,
    createPassportFile: CreatePassportFile,
    wrappingKey: string,
    reportProgress: ReportGoogleBackedIdentityProgress,
  ): Promise<CreateGoogleBackedIdentityResult> {
    LOGGER.info("identity.google.create.started");
    const created = await this.#pubky.createIdentityKey();
    if (Result.isError(created)) return failure("create_failed");

    try {
      const secretKey = await this.#pubky.exportSecretKey(created.value.keyHandle);
      if (Result.isError(secretKey)) return failure("create_failed");

      try {
        reportProgress("storing_encrypted_identity");
        LOGGER.info("identity.google.encrypt.started");
        const envelope = await this.#encryptSecretKeyBytes({
          secretKeyBytes: secretKey.value.bytes,
          wrappingKey,
          passportOrigin: this.#passportOrigin,
        });
        if (Result.isError(envelope)) return failure("encrypt_failed");

        LOGGER.info("identity.google.drive_write.started");
        const written = await createPassportFile(envelope.value);
        if (Result.isError(written)) return failure(written.error.code === "create_conflict" ? "drive_create_conflict" : "drive_write_failed");
        LOGGER.info("identity.google.drive_write.completed");
      } finally {
        secretKey.value.bytes.fill(0);
      }

      reportProgress("signing_up_to_homeserver");
      LOGGER.info("identity.google.signup.started");
      const signedUp = await this.#pubky.signup({
        keyHandle: created.value.keyHandle,
        homeserverPubky: invitation.homeserverPubky,
        signupCode: invitation.signupCode,
      });
      if (Result.isError(signedUp)) return failure("signup_failed", created.value.publicIdentity);
      if (signedUp.value.publicIdentity.publicKeyZ32 !== created.value.publicIdentity.publicKeyZ32) {
        LOGGER.warn("identity.google.activation_identity.failed");
        return failure("identity_mismatch", created.value.publicIdentity);
      }

      reportProgress("publishing_discovery");
      LOGGER.info("identity.google.discovery.started");
      const published = await this.#pubky.publishHomeserverIfStale({
        keyHandle: created.value.keyHandle,
        homeserverPubky: invitation.homeserverPubky,
      });
      if (Result.isError(published)) return failure("discovery_failed", created.value.publicIdentity);

      reportProgress("activating_created_identity");
      LOGGER.info("identity.local_save.started", { establishmentMode: "created" });
      const saved = await this.#saveLocalIdentity.saveIdentity(created.value.keyHandle);
      if (Result.isError(saved)) return failure("local_save_failed", created.value.publicIdentity);

      LOGGER.info("identity.local_save.completed", { establishmentMode: "created" });
      return Result.ok({
        establishmentMode: "created" as const,
        publicIdentity: created.value.publicIdentity,
      });
    } finally {
      try {
        this.#pubky.disposeIdentityKey(created.value.keyHandle);
      } catch {
        LOGGER.warn("identity.google.cleanup.failed", { operation: "created_key_dispose" });
      }
    }
  }
}

type CreatePassportFile = (
  envelope: PassportFileEnvelopeV1,
) => Promise<PassportFileStoreResult<PassportFileReference>>;

function failure<T>(
  code: CreateGoogleBackedIdentityErrorCode,
  preservedPassportFileIdentity?: PubkyPublicIdentity,
): CreateGoogleBackedIdentityResult<T> {
  return Result.err({ code, ...(preservedPassportFileIdentity ? { preservedPassportFileIdentity } : {}) });
}
