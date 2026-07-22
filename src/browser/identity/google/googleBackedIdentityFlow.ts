import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { LocalIdentityRepository } from "../localIdentityRepository";
import type { PassportFileCrypto, PassportFileStore } from "../../passport-file/passportFilePorts";
import type { PubkyIdentityKeys } from "../../pubky/pubkyPorts";
import { pubkySecretKeyFormat, type PubkyIdentityKey } from "../../../features/identity/pubkyIdentity";
import type { GoogleIdentitySession } from "./googleIdentityProvider";
import { logger } from "../../../libs/logger/logger";

export type GoogleBackedIdentityFlowErrorCode =
  | "google_unavailable"
  | "sign_in_failed"
  | "drive_consent_failed"
  | "wrapping_key_failed"
  | "drive_read_failed"
  | "decrypt_failed"
  | "restore_failed"
  | "identity_mismatch"
  | "create_failed"
  | "encrypt_failed"
  | "drive_write_failed"
  | "drive_delete_failed"
  | "local_save_failed";

export type GoogleBackedIdentityFlowResult<T> = ResultType<T, { code: GoogleBackedIdentityFlowErrorCode }>;
export type GoogleBackedIdentity = PubkyIdentityKey & { source: "restored" | "created" };

export type GoogleWrappingKeyRequester = {
  requestWrappingKey(input: { googleIdToken: string }): Promise<ResultType<string, { code: string }>>;
};

export class GoogleBackedIdentityFlow {
  readonly #wrappingKeys: GoogleWrappingKeyRequester;
  readonly #passportFilesForAccessToken: (driveAccessToken: string) => PassportFileStore;
  readonly #crypto: PassportFileCrypto;
  readonly #identityKeys: PubkyIdentityKeys;
  readonly #localIdentities: LocalIdentityRepository;
  readonly #passportUrl: string;

  constructor(input: {
    wrappingKeys: GoogleWrappingKeyRequester;
    passportFilesForAccessToken: (driveAccessToken: string) => PassportFileStore;
    crypto: PassportFileCrypto;
    identityKeys: PubkyIdentityKeys;
    localIdentities: LocalIdentityRepository;
    passportUrl: string;
  }) {
    this.#wrappingKeys = input.wrappingKeys;
    this.#passportFilesForAccessToken = input.passportFilesForAccessToken;
    this.#crypto = input.crypto;
    this.#identityKeys = input.identityKeys;
    this.#localIdentities = input.localIdentities;
    this.#passportUrl = input.passportUrl;
  }

  async establish(google: GoogleIdentitySession): Promise<GoogleBackedIdentityFlowResult<GoogleBackedIdentity>> {
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

      try {
        const restored = await this.#identityKeys.restoreIdentityKey({ secretKey: { bytes: secretKey.value, format: pubkySecretKeyFormat } });
        if (Result.isError(restored)) {
          logger.warn("identity.google.restore.failed", { code: restored.error.code });
          return failure("restore_failed");
        }
        logger.info("identity.google.restore.completed");
        return await this.save(restored.value, "restored");
      } finally {
        secretKey.value.fill(0);
      }
    }

    logger.info("identity.google.drive_read.completed", { status: "missing" });
    logger.info("identity.google.create.started");
    const created = await this.#identityKeys.createIdentityKey();
    if (Result.isError(created)) {
      logger.warn("identity.google.create.failed", { code: created.error.code });
      return failure("create_failed");
    }

    const secretKey = await this.#identityKeys.exportSecretKey({ keyHandle: created.value.keyHandle });
    if (Result.isError(secretKey)) {
      logger.warn("identity.google.create.failed", { code: secretKey.error.code });
      this.#identityKeys.disposeIdentityKey({ keyHandle: created.value.keyHandle });
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
        this.#identityKeys.disposeIdentityKey({ keyHandle: created.value.keyHandle });
        return failure("encrypt_failed");
      }

      logger.info("identity.google.drive_write.started");
      const written = await passportFiles.writePassportFile({ envelope: envelope.value });
      if (Result.isError(written)) {
        logger.warn("identity.google.drive_write.failed", { code: written.error.code });
        this.#identityKeys.disposeIdentityKey({ keyHandle: created.value.keyHandle });
        return failure("drive_write_failed");
      }
      logger.info("identity.google.drive_write.completed");
    } finally {
      secretKey.value.bytes.fill(0);
    }

    return this.save(created.value, "created");
  }

  async deleteIdentity(google: GoogleIdentitySession, expectedPublicKeyZ32: string): Promise<GoogleBackedIdentityFlowResult<void>> {
    const wrappingKey = await this.#wrappingKeys.requestWrappingKey({ googleIdToken: google.googleIdToken });
    if (Result.isError(wrappingKey)) return failure("wrapping_key_failed");

    const passportFiles = this.#passportFilesForAccessToken(google.driveAccessToken);
    const storedFile = await passportFiles.readPassportFile();
    if (Result.isError(storedFile) || storedFile.value.status === "missing") return failure("drive_read_failed");

    const secretKey = await this.#crypto.decryptSecretKeyBytes({
      envelope: storedFile.value.envelope,
      wrappingKey: wrappingKey.value,
      passportUrl: this.#passportUrl,
    });
    if (Result.isError(secretKey)) return failure("decrypt_failed");

    try {
      const restored = await this.#identityKeys.restoreIdentityKey({ secretKey: { bytes: secretKey.value, format: pubkySecretKeyFormat } });
      if (Result.isError(restored)) return failure("restore_failed");

      this.#identityKeys.disposeIdentityKey({ keyHandle: restored.value.keyHandle });
      if (restored.value.publicIdentity.publicKeyZ32 !== expectedPublicKeyZ32) return failure("identity_mismatch");
    } finally {
      secretKey.value.fill(0);
    }

    const deleted = await passportFiles.deletePassportFile();
    return Result.isError(deleted) ? failure("drive_delete_failed") : Result.ok();
  }

  private async save(identity: PubkyIdentityKey, source: GoogleBackedIdentity["source"]): Promise<GoogleBackedIdentityFlowResult<GoogleBackedIdentity>> {
    logger.info("identity.local_save.started", { source });
    const saved = await this.#localIdentities.saveIdentity({ identityKeys: this.#identityKeys, keyHandle: identity.keyHandle });
    if (Result.isError(saved)) {
      logger.warn("identity.local_save.failed", { code: saved.error.code });
      this.#identityKeys.disposeIdentityKey({ keyHandle: identity.keyHandle });
      return failure("local_save_failed");
    }

    logger.info("identity.local_save.completed", { source });
    return Result.ok({ ...identity, source });
  }
}

function failure<T>(code: GoogleBackedIdentityFlowErrorCode): GoogleBackedIdentityFlowResult<T> {
  return Result.err({ code });
}
