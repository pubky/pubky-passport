import "client-only";

import { Result } from "better-result";

import type { PubkyIdentityKey } from "../../../pubky/application/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../../pubky/adapters/pubkySdkAdapter";
import { LOGGER } from "../../../../libs/logger/logger";
import type { PassportFileEnvelopeV1 } from "../../../../core/passport-file/passportFile";
import type { EncryptPassportSecret } from "../../../passport-file/application/passportFileCryptoResults";
import type { PassportFileReference, PassportFileStoreResult } from "../../../passport-file/application/passportFileStoreModels";
import type { HomeserverSignupInvitation } from "../../../homegate/homegateClient";
import type {
  GoogleBackedIdentity,
  GoogleBackedIdentityResult,
} from "./googleBackedIdentity";
import { SaveLocalIdentity } from "../../local-identity/application/saveLocalIdentity";

export class CreateGoogleBackedIdentity {
  readonly #encryptSecretKeyBytes: EncryptPassportSecret;
  readonly #pubky: PubkySdkAdapter;
  readonly #localIdentities: SaveLocalIdentity;
  readonly #passportOrigin: string;

  constructor(input: {
    encryptSecretKeyBytes: EncryptPassportSecret;
    pubky: PubkySdkAdapter;
    localIdentities: SaveLocalIdentity;
    passportOrigin: string;
  }) {
    this.#encryptSecretKeyBytes = input.encryptSecretKeyBytes;
    this.#pubky = input.pubky;
    this.#localIdentities = input.localIdentities;
    this.#passportOrigin = input.passportOrigin;
  }

  async execute(
    invitation: HomeserverSignupInvitation,
    createPassportFile: CreatePassportFile,
    wrappingKey: string,
  ): Promise<GoogleBackedIdentityResult<GoogleBackedIdentity>> {
    LOGGER.info("identity.google.create.started");
    const created = await this.#pubky.createIdentityKey();
    if (Result.isError(created)) {
      LOGGER.warn("identity.google.create.failed", { code: created.error.code });
      return failure("create_failed");
    }

    try {
      const secretKey = await this.#pubky.exportSecretKey(created.value.keyHandle);
      if (Result.isError(secretKey)) {
        LOGGER.warn("identity.google.create.failed", { code: secretKey.error.code });
        return failure("create_failed");
      }

      try {
        LOGGER.info("identity.google.encrypt.started");
        const envelope = await this.#encryptSecretKeyBytes({
          secretKeyBytes: secretKey.value.bytes,
          wrappingKey,
          passportOrigin: this.#passportOrigin,
        });
        if (Result.isError(envelope)) {
          LOGGER.warn("identity.google.encrypt.failed", { code: envelope.error.code });
          return failure("encrypt_failed");
        }

        LOGGER.info("identity.google.drive_write.started");
        const written = await createPassportFile(envelope.value);
        if (Result.isError(written)) {
          LOGGER.warn("identity.google.drive_write.failed", { code: written.error.code });
          return failure(written.error.code === "create_conflict" ? "drive_create_conflict" : "drive_write_failed");
        }
        LOGGER.info("identity.google.drive_write.completed");
      } finally {
        secretKey.value.bytes.fill(0);
      }

      LOGGER.info("identity.google.signup.started");
      const signedUp = await this.#pubky.signup({
        keyHandle: created.value.keyHandle,
        homeserverPubky: invitation.homeserverPubky,
        signupCode: invitation.signupCode,
      });
      if (Result.isError(signedUp)) {
        LOGGER.warn("identity.google.signup.failed", { code: signedUp.error.code });
        return failure("signup_failed", created.value.publicIdentity);
      }
      if (signedUp.value.publicIdentity.publicKeyZ32 !== created.value.publicIdentity.publicKeyZ32) {
        LOGGER.warn("identity.google.activation_identity.failed");
        return failure("identity_mismatch", created.value.publicIdentity);
      }

      LOGGER.info("identity.google.discovery.started");
      const published = await this.#pubky.publishHomeserverIfStale({
        keyHandle: created.value.keyHandle,
        homeserverPubky: invitation.homeserverPubky,
      });
      if (Result.isError(published)) {
        LOGGER.warn("identity.google.discovery.failed", { code: published.error.code });
        return failure("discovery_failed", created.value.publicIdentity);
      }

      LOGGER.info("identity.local_save.started", { establishmentMode: "created" });
      const saved = await this.#localIdentities.saveIdentity(created.value.keyHandle);
      if (Result.isError(saved)) {
        LOGGER.warn("identity.local_save.failed", { code: saved.error.code });
        return failure("local_save_failed", created.value.publicIdentity);
      }

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
  code: Parameters<typeof createError>[0],
  partialSetupPublicIdentity?: Parameters<typeof createError>[1],
): GoogleBackedIdentityResult<T> {
  return Result.err(createError(code, partialSetupPublicIdentity));
}

function createError(
  code:
    | "create_failed"
    | "encrypt_failed"
    | "drive_create_conflict"
    | "drive_write_failed"
    | "signup_failed"
    | "identity_mismatch"
    | "discovery_failed"
    | "local_save_failed",
  partialSetupPublicIdentity?: PubkyIdentityKey["publicIdentity"],
) {
  return { code, ...(partialSetupPublicIdentity ? { partialSetupPublicIdentity } : {}) };
}
