import "client-only";

import { Result } from "better-result";

import type { PubkyIdentityKey, PubkyIdentityKeys } from "../../../pubky/application/pubkyIdentityKeys";
import { LOGGER } from "../../../../libs/logger/logger";
import type { PassportFileCrypto } from "../../../passport-file/application/passportFileCrypto";
import type { PubkyDiscovery } from "../../../pubky/application/pubkyDiscovery";
import type { PubkySessionAccess } from "../../../pubky/application/pubkySessionAccess";
import type {
  GoogleBackedIdentityCreator,
  GoogleBackedIdentity,
  GoogleBackedIdentityResult,
} from "./googleBackedIdentity";
import type { LocalIdentitySaver } from "../../local-identity/application/saveLocalIdentity";

export class CreateGoogleBackedIdentity implements GoogleBackedIdentityCreator {
  readonly #crypto: PassportFileCrypto;
  readonly #identityKeys: PubkyIdentityKeys;
  readonly #sessionAccess: PubkySessionAccess;
  readonly #discovery: PubkyDiscovery;
  readonly #localIdentities: LocalIdentitySaver;
  readonly #passportOrigin: string;

  constructor(input: {
    crypto: PassportFileCrypto;
    identityKeys: PubkyIdentityKeys;
    sessionAccess: PubkySessionAccess;
    discovery: PubkyDiscovery;
    localIdentities: LocalIdentitySaver;
    passportOrigin: string;
  }) {
    this.#crypto = input.crypto;
    this.#identityKeys = input.identityKeys;
    this.#sessionAccess = input.sessionAccess;
    this.#discovery = input.discovery;
    this.#localIdentities = input.localIdentities;
    this.#passportOrigin = input.passportOrigin;
  }

  async execute(
    input: Parameters<GoogleBackedIdentityCreator["execute"]>[0],
  ): Promise<GoogleBackedIdentityResult<GoogleBackedIdentity>> {
    LOGGER.info("identity.google.create.started");
    const created = await this.#identityKeys.createIdentityKey();
    if (Result.isError(created)) {
      LOGGER.warn("identity.google.create.failed", { code: created.error.code });
      return failure("create_failed");
    }

    try {
      const secretKey = await this.#identityKeys.exportSecretKey({ keyHandle: created.value.keyHandle });
      if (Result.isError(secretKey)) {
        LOGGER.warn("identity.google.create.failed", { code: secretKey.error.code });
        return failure("create_failed");
      }

      try {
        LOGGER.info("identity.google.encrypt.started");
        const envelope = await this.#crypto.encryptSecretKeyBytes({
          secretKeyBytes: secretKey.value.bytes,
          wrappingKey: input.wrappingKey,
          passportOrigin: this.#passportOrigin,
        });
        if (Result.isError(envelope)) {
          LOGGER.warn("identity.google.encrypt.failed", { code: envelope.error.code });
          return failure("encrypt_failed");
        }

        LOGGER.info("identity.google.drive_write.started");
        const written = await input.passportFileStore.createPassportFile({ envelope: envelope.value });
        if (Result.isError(written)) {
          LOGGER.warn("identity.google.drive_write.failed", { code: written.error.code });
          return failure(written.error.code === "create_conflict" ? "drive_create_conflict" : "drive_write_failed");
        }
        LOGGER.info("identity.google.drive_write.completed");
      } finally {
        secretKey.value.bytes.fill(0);
      }

      LOGGER.info("identity.google.signup.started");
      const signedUp = await this.#sessionAccess.signup({
        keyHandle: created.value.keyHandle,
        homeserverPubky: input.invitation.homeserverPubky,
        signupCode: input.invitation.signupCode,
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
      const published = await this.#discovery.publishHomeserverIfStale({
        keyHandle: created.value.keyHandle,
        homeserverPubky: input.invitation.homeserverPubky,
      });
      if (Result.isError(published)) {
        LOGGER.warn("identity.google.discovery.failed", { code: published.error.code });
        return failure("discovery_failed", created.value.publicIdentity);
      }

      LOGGER.info("identity.local_save.started", { source: "created" });
      const saved = await this.#localIdentities.saveIdentity({ keyHandle: created.value.keyHandle });
      if (Result.isError(saved)) {
        LOGGER.warn("identity.local_save.failed", { code: saved.error.code });
        return failure("local_save_failed", created.value.publicIdentity);
      }

      LOGGER.info("identity.local_save.completed", { source: "created" });
      return Result.ok({
        source: "created" as const,
        publicIdentity: created.value.publicIdentity,
      });
    } finally {
      try {
        this.#identityKeys.disposeIdentityKey({ keyHandle: created.value.keyHandle });
      } catch {
        LOGGER.warn("identity.google.cleanup.failed", { operation: "created_key_dispose" });
      }
    }
  }
}

function failure<T>(
  code: Parameters<typeof createError>[0],
  recoverablePublicIdentity?: Parameters<typeof createError>[1],
): GoogleBackedIdentityResult<T> {
  return Result.err(createError(code, recoverablePublicIdentity));
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
  recoverablePublicIdentity?: PubkyIdentityKey["publicIdentity"],
) {
  return { code, ...(recoverablePublicIdentity ? { recoverablePublicIdentity } : {}) };
}
