import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { LocalIdentitySaver } from "../localIdentityService";
import type {
  PassportFileCrypto,
  PassportFileStore,
  PubkyDiscovery,
  PubkyIdentityKeys,
  PubkySignup,
} from "../applicationContracts";
import {
  pubkySecretKeyFormat,
  type PubkyIdentityKey,
  type PubkyPublicIdentity,
} from "../../../features/identity/pubkyIdentity";
import type {
  GoogleHomegateInviteRequester,
  GoogleIdentitySession,
  GoogleWrappingKeyRequester,
} from "./applicationContracts";
import { logger } from "../../../libs/logger/logger";

export type GoogleBackedIdentityFlowErrorCode =
  | "wrapping_key_failed"
  | "drive_read_failed"
  | "decrypt_failed"
  | "restore_failed"
  | "identity_mismatch"
  | "create_failed"
  | "encrypt_failed"
  | "drive_create_conflict"
  | "drive_write_failed"
  | "homegate_invite_failed"
  | "signup_failed"
  | "signin_failed"
  | "discovery_failed"
  | "local_save_failed"
  | "unexpected_failure";

export type GoogleBackedIdentityFlowError = {
  code: GoogleBackedIdentityFlowErrorCode;
  recoverablePublicIdentity?: PubkyPublicIdentity;
};
export type GoogleBackedIdentityFlowResult<T> = ResultType<T, GoogleBackedIdentityFlowError>;
export type GoogleBackedIdentity = PubkyIdentityKey & { source: "restored" | "created" };

export class GoogleBackedIdentityFlow {
  readonly #wrappingKeys: GoogleWrappingKeyRequester;
  readonly #passportFilesForAccessToken: (driveAccessToken: string) => PassportFileStore;
  readonly #crypto: PassportFileCrypto;
  readonly #identityKeys: PubkyIdentityKeys;
  readonly #homegateInvites: GoogleHomegateInviteRequester;
  readonly #signup: PubkySignup;
  readonly #discovery: PubkyDiscovery;
  readonly #localIdentities: LocalIdentitySaver;
  readonly #passportUrl: string;

  constructor(input: {
    wrappingKeys: GoogleWrappingKeyRequester;
    passportFilesForAccessToken: (driveAccessToken: string) => PassportFileStore;
    crypto: PassportFileCrypto;
    identityKeys: PubkyIdentityKeys;
    homegateInvites: GoogleHomegateInviteRequester;
    signup: PubkySignup;
    discovery: PubkyDiscovery;
    localIdentities: LocalIdentitySaver;
    passportUrl: string;
  }) {
    this.#wrappingKeys = input.wrappingKeys;
    this.#passportFilesForAccessToken = input.passportFilesForAccessToken;
    this.#crypto = input.crypto;
    this.#identityKeys = input.identityKeys;
    this.#homegateInvites = input.homegateInvites;
    this.#signup = input.signup;
    this.#discovery = input.discovery;
    this.#localIdentities = input.localIdentities;
    this.#passportUrl = input.passportUrl;
  }

  async establish(google: GoogleIdentitySession): Promise<GoogleBackedIdentityFlowResult<GoogleBackedIdentity>> {
    try {
      return await this.establishIdentity(google);
    } catch {
      logger.warn("identity.google.establish.failed", { code: "unexpected_failure" });
      return failure("unexpected_failure");
    }
  }

  private async establishIdentity(google: GoogleIdentitySession): Promise<GoogleBackedIdentityFlowResult<GoogleBackedIdentity>> {
    logger.info("identity.google.wrapping_key.started");
    const wrappingKey = await this.#wrappingKeys.requestWrappingKey({ googleIdToken: google.googleIdToken });
    if (Result.isError(wrappingKey)) {
      logger.warn("identity.google.wrapping_key.failed", { code: wrappingKey.error.code });
      return failure("wrapping_key_failed");
    }
    logger.info("identity.google.wrapping_key.completed");

    const passportFiles = this.#passportFilesForAccessToken(google.driveAccessToken);
    logger.info("identity.google.drive_read.started");
    const storedFile = await passportFiles.readPassportFile();
    if (Result.isError(storedFile)) {
      logger.warn("identity.google.drive_read.failed", { code: storedFile.error.code });
      return failure("drive_read_failed");
    } else if (storedFile.value.status === "found") {
      logger.info("identity.google.drive_read.completed", { status: "found" });
      logger.info("identity.google.decrypt.started");
      const secretKey = await this.#crypto.decryptSecretKeyBytes({
        envelope: storedFile.value.envelope,
        wrappingKey: wrappingKey.value,
        passportUrl: this.#passportUrl,
      });
      if (Result.isError(secretKey)) {
        logger.warn("identity.google.decrypt.failed", { code: secretKey.error.code });
        return failure("decrypt_failed");
      }

      let restoredIdentity: PubkyIdentityKey | null = null;
      let retainRestoredIdentity = false;
      try {
        const restored = await this.#identityKeys.restoreIdentityKey({ secretKey: { bytes: secretKey.value, format: pubkySecretKeyFormat } });
        if (Result.isError(restored)) {
          logger.warn("identity.google.restore.failed", { code: restored.error.code });
          return failure("restore_failed");
        }
        restoredIdentity = restored.value;
        logger.info("identity.google.restore.completed");
        const signedIn = await this.#signup.signin({ keyHandle: restored.value.keyHandle, waitForDiscovery: true });
        if (Result.isError(signedIn)) {
          logger.warn("identity.google.signin.failed", { code: signedIn.error.code });
          return failure("signin_failed", restored.value.publicIdentity);
        }
        if (signedIn.value.publicIdentity.publicKeyZ32 !== restored.value.publicIdentity.publicKeyZ32) {
          logger.warn("identity.google.activation_identity.failed");
          return failure("identity_mismatch", restored.value.publicIdentity);
        }
        const saved = await this.save(restored.value, "restored");
        if (!Result.isError(saved)) retainRestoredIdentity = true;
        return saved;
      } finally {
        secretKey.value.fill(0);
        if (restoredIdentity && !retainRestoredIdentity) {
          this.#identityKeys.disposeIdentityKey({ keyHandle: restoredIdentity.keyHandle });
        }
      }
    }

    logger.info("identity.google.drive_read.completed", { status: "missing" });
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
          wrappingKey: wrappingKey.value,
          passportUrl: this.#passportUrl,
        });
        if (Result.isError(envelope)) {
          logger.warn("identity.google.encrypt.failed", { code: envelope.error.code });
          return failure("encrypt_failed");
        }

        logger.info("identity.google.drive_write.started");
        const written = await passportFiles.createPassportFile({ envelope: envelope.value });
        if (Result.isError(written)) {
          logger.warn("identity.google.drive_write.failed", { code: written.error.code });
          return failure(written.error.code === "create_conflict" ? "drive_create_conflict" : "drive_write_failed");
        }
        logger.info("identity.google.drive_write.completed");
      } finally {
        secretKey.value.bytes.fill(0);
      }

      logger.info("identity.google.homegate_invite.started");
      const invitation = await this.#homegateInvites.requestSignupInvitation({ googleIdToken: google.googleIdToken });
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

      const saved = await this.save(created.value, "created");
      if (!Result.isError(saved)) retainCreatedIdentity = true;
      return saved;
    } finally {
      if (!retainCreatedIdentity) {
        this.#identityKeys.disposeIdentityKey({ keyHandle: created.value.keyHandle });
      }
    }
  }

  private async save(identity: PubkyIdentityKey, source: GoogleBackedIdentity["source"]): Promise<GoogleBackedIdentityFlowResult<GoogleBackedIdentity>> {
    logger.info("identity.local_save.started", { source });
    const saved = await this.#localIdentities.saveIdentity({ keyHandle: identity.keyHandle });
    if (Result.isError(saved)) {
      logger.warn("identity.local_save.failed", { code: saved.error.code });
      return failure("local_save_failed", identity.publicIdentity);
    }

    logger.info("identity.local_save.completed", { source });
    return Result.ok({ ...identity, source });
  }
}

function failure<T>(
  code: GoogleBackedIdentityFlowErrorCode,
  recoverablePublicIdentity?: PubkyPublicIdentity,
): GoogleBackedIdentityFlowResult<T> {
  return Result.err({
    code,
    ...(recoverablePublicIdentity ? { recoverablePublicIdentity } : {}),
  });
}
