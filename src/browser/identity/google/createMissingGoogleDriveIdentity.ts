import "client-only";

import { Result } from "better-result";

import type { PubkyIdentityKey } from "../../../features/identity/pubkyIdentity";
import { logger } from "../../../libs/logger/logger";
import type { PassportFileCrypto } from "../../passport-file/ports";
import type {
  PubkyDiscovery,
  PubkyIdentityKeys,
  PubkySignup,
} from "../../pubky/ports";
import type { LocalIdentitySaver } from "../localIdentityService";
import type {
  CreateMissingGoogleDriveIdentity,
  GoogleBackedIdentity,
  GoogleBackedIdentityFlowResult,
  GoogleHomegateInviteRequester,
} from "./ports";

export class CreateMissingGoogleDriveIdentityUseCase implements CreateMissingGoogleDriveIdentity {
  readonly #crypto: PassportFileCrypto;
  readonly #identityKeys: PubkyIdentityKeys;
  readonly #homegateInvites: GoogleHomegateInviteRequester;
  readonly #signup: PubkySignup;
  readonly #discovery: PubkyDiscovery;
  readonly #localIdentities: LocalIdentitySaver;
  readonly #passportUrl: string;

  constructor(input: {
    crypto: PassportFileCrypto;
    identityKeys: PubkyIdentityKeys;
    homegateInvites: GoogleHomegateInviteRequester;
    signup: PubkySignup;
    discovery: PubkyDiscovery;
    localIdentities: LocalIdentitySaver;
    passportUrl: string;
  }) {
    this.#crypto = input.crypto;
    this.#identityKeys = input.identityKeys;
    this.#homegateInvites = input.homegateInvites;
    this.#signup = input.signup;
    this.#discovery = input.discovery;
    this.#localIdentities = input.localIdentities;
    this.#passportUrl = input.passportUrl;
  }

  async execute(
    input: Parameters<CreateMissingGoogleDriveIdentity["execute"]>[0],
  ): Promise<GoogleBackedIdentityFlowResult<GoogleBackedIdentity>> {
    logger.info("identity.google.create.started");
    const created = await this.#identityKeys.createIdentityKey();
    if (Result.isError(created)) {
      logger.warn("identity.google.create.failed", { code: created.error.code });
      return failure("create_failed");
    }

    let retainCreatedIdentity = false;
    try {
      const secretKey = await this.#identityKeys.exportSecretKey({ keyHandle: created.value.keyHandle });
      if (Result.isError(secretKey)) {
        logger.warn("identity.google.create.failed", { code: secretKey.error.code });
        return failure("create_failed");
      }

      try {
        logger.info("identity.google.encrypt.started");
        const envelope = await this.#crypto.encryptSecretKeyBytes({
          secretKeyBytes: secretKey.value.bytes,
          wrappingKey: input.wrappingKey,
          passportUrl: this.#passportUrl,
        });
        if (Result.isError(envelope)) {
          logger.warn("identity.google.encrypt.failed", { code: envelope.error.code });
          return failure("encrypt_failed");
        }

        logger.info("identity.google.drive_write.started");
        const written = await input.passportFiles.createPassportFile({ envelope: envelope.value });
        if (Result.isError(written)) {
          logger.warn("identity.google.drive_write.failed", { code: written.error.code });
          return failure(written.error.code === "create_conflict" ? "drive_create_conflict" : "drive_write_failed");
        }
        logger.info("identity.google.drive_write.completed");
      } finally {
        secretKey.value.bytes.fill(0);
      }

      logger.info("identity.google.homegate_invite.started");
      const invitation = await this.#homegateInvites.requestSignupInvitation({ googleIdToken: input.googleIdToken });
      if (Result.isError(invitation)) {
        logger.warn("identity.google.homegate_invite.failed", { code: invitation.error.code });
        return failure("homegate_invite_failed", created.value.publicIdentity);
      }

      logger.info("identity.google.signup.started");
      const signedUp = await this.#signup.signup({
        keyHandle: created.value.keyHandle,
        homeserverPubky: invitation.value.homeserverPubky,
        signupCode: invitation.value.signupCode,
      });
      if (Result.isError(signedUp)) {
        logger.warn("identity.google.signup.failed", { code: signedUp.error.code });
        return failure("signup_failed", created.value.publicIdentity);
      }
      if (signedUp.value.publicIdentity.publicKeyZ32 !== created.value.publicIdentity.publicKeyZ32) {
        logger.warn("identity.google.activation_identity.failed");
        return failure("identity_mismatch", created.value.publicIdentity);
      }

      logger.info("identity.google.discovery.started");
      const published = await this.#discovery.publishHomeserverIfStale({
        keyHandle: created.value.keyHandle,
        homeserverPubky: invitation.value.homeserverPubky,
      });
      if (Result.isError(published)) {
        logger.warn("identity.google.discovery.failed", { code: published.error.code });
        return failure("discovery_failed", created.value.publicIdentity);
      }

      logger.info("identity.local_save.started", { source: "created" });
      const saved = await this.#localIdentities.saveIdentity({ keyHandle: created.value.keyHandle });
      if (Result.isError(saved)) {
        logger.warn("identity.local_save.failed", { code: saved.error.code });
        return failure("local_save_failed", created.value.publicIdentity);
      }

      logger.info("identity.local_save.completed", { source: "created" });
      retainCreatedIdentity = true;
      return Result.ok({ ...created.value, source: "created" as const });
    } finally {
      if (!retainCreatedIdentity) {
        try {
          this.#identityKeys.disposeIdentityKey({ keyHandle: created.value.keyHandle });
        } catch {
          logger.warn("identity.google.cleanup.failed", { operation: "created_key_dispose" });
        }
      }
    }
  }
}

function failure<T>(
  code: Parameters<typeof createError>[0],
  recoverablePublicIdentity?: Parameters<typeof createError>[1],
): GoogleBackedIdentityFlowResult<T> {
  return Result.err(createError(code, recoverablePublicIdentity));
}

function createError(
  code:
    | "create_failed"
    | "encrypt_failed"
    | "drive_create_conflict"
    | "drive_write_failed"
    | "homegate_invite_failed"
    | "signup_failed"
    | "identity_mismatch"
    | "discovery_failed"
    | "local_save_failed",
  recoverablePublicIdentity?: PubkyIdentityKey["publicIdentity"],
) {
  return { code, ...(recoverablePublicIdentity ? { recoverablePublicIdentity } : {}) };
}
