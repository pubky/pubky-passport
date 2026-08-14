import "client-only";

import { Result, type Result as ResultType } from "better-result";
import type { GoogleAccountProfile } from "./googleBackedIdentityCredentials";

import type { PubkyPublicIdentity } from "../pubkyPublicIdentity";
import { PubkySdkAdapter } from "../../pubky/pubkySdkAdapter";
import { LOGGER } from "../../../../libs/logger/logger";
import type { PassportFileStoreResult } from "../../passport-file/googleDrivePassportFileStore";
import type { PassportFileEnvelopeV1 } from "../../passport-file/passportFileEnvelope";
import type { EncryptPassportSecret } from "../../passport-file/passportFileWebCrypto";
import type { HomeserverSignupInvitation } from "../../homegate/homegateClient";
import type {
  ActivateGoogleBackedIdentity,
  ActivateGoogleBackedIdentityProgress,
} from "./activateGoogleBackedIdentity";

const VISIBLE_RECOVERY_COPY_TIMEOUT_MS = 10_000;

type CreateGoogleBackedIdentityErrorCode =
  | "create_failed"
  | "encrypt_failed"
  | "drive_create_conflict"
  | "drive_write_failed"
  | "signup_failed"
  | "identity_mismatch"
  | "discovery_failed"
  | "local_save_failed"
  | "unexpected_failure";

export type CreateGoogleBackedIdentityError = {
  code: CreateGoogleBackedIdentityErrorCode;
  preservedPassportFileIdentity?: PubkyPublicIdentity;
  warning?: "visible_recovery_copy_unconfirmed";
};

export type CreatedGoogleBackedIdentity = {
  establishmentMode: "created";
  publicIdentity: PubkyPublicIdentity;
  visibleRecoveryCopyStatus: "created" | "unconfirmed";
};

export type CreateGoogleBackedIdentityResult<Success = CreatedGoogleBackedIdentity> = ResultType<
  Success,
  CreateGoogleBackedIdentityError
>;

export type CreateGoogleBackedIdentityProgress =
  | "storing_encrypted_identity"
  | ActivateGoogleBackedIdentityProgress;

export type ReportCreateGoogleBackedIdentityProgress = (
  progress: CreateGoogleBackedIdentityProgress,
) => void;

export class CreateGoogleBackedIdentity {
  readonly #encryptSecretKeyBytes: EncryptPassportSecret;
  readonly #pubky: PubkySdkAdapter;
  readonly #activateIdentity: ActivateGoogleBackedIdentity["execute"];
  readonly #passportOrigin: string;
  readonly #visibleRecoveryCopyTimeoutMs: number;

  constructor(input: {
    encryptSecretKeyBytes: EncryptPassportSecret;
    pubky: PubkySdkAdapter;
    activateIdentity: ActivateGoogleBackedIdentity["execute"];
    passportOrigin: string;
    visibleRecoveryCopyTimeoutMs?: number;
  }) {
    this.#encryptSecretKeyBytes = input.encryptSecretKeyBytes;
    this.#pubky = input.pubky;
    this.#activateIdentity = input.activateIdentity;
    this.#passportOrigin = input.passportOrigin;
    this.#visibleRecoveryCopyTimeoutMs = input.visibleRecoveryCopyTimeoutMs ?? VISIBLE_RECOVERY_COPY_TIMEOUT_MS;
  }

  async execute(
    invitation: HomeserverSignupInvitation,
    createPassportFile: CreatePassportFile,
    createVisibleRecoveryCopy: CreateVisibleRecoveryCopy,
    wrappingKey: string,
    reportProgress: ReportCreateGoogleBackedIdentityProgress,
    googleAccount?: GoogleAccountProfile,
  ): Promise<CreateGoogleBackedIdentityResult> {
    LOGGER.info("identity.google.create.started");
    LOGGER.info("identity.google.create_key.started");
    const created = await this.#pubky.createIdentityKey();
    if (Result.isError(created)) return failure("create_failed");
    LOGGER.info("identity.google.create_key.completed");

    try {
      const secretKey = await this.#pubky.exportSecretKey(created.value.keyHandle);
      if (Result.isError(secretKey)) return failure("create_failed");

      let visibleRecoveryCopyStatus: CreatedGoogleBackedIdentity["visibleRecoveryCopyStatus"] = "created";
      try {
        reportProgress("storing_encrypted_identity");
        LOGGER.info("identity.google.encrypt.started");
        const envelope = await this.#encryptSecretKeyBytes({
          secretKeyBytes: secretKey.value.bytes,
          wrappingKey,
          passportOrigin: this.#passportOrigin,
        });
        if (Result.isError(envelope)) return failure("encrypt_failed");
        LOGGER.info("identity.google.encrypt.completed");

        LOGGER.info("identity.google.operational_drive_write.started");
        const written = await createPassportFile(envelope.value);
        if (Result.isError(written)) {
          if (written.error.code === "create_conflict") return failure("drive_create_conflict");
          return failure("drive_write_failed");
        }
        LOGGER.info("identity.google.operational_drive_write.completed");

        LOGGER.info("identity.google.visible_recovery_copy.started");
        const visibleCopyConfirmed = await createVisibleRecoveryCopyBeforeDeadline(
          createVisibleRecoveryCopy,
          envelope.value,
          created.value.publicIdentity.publicKeyDisplay,
          this.#visibleRecoveryCopyTimeoutMs,
        );
        const visibleCopyUnconfirmed = !visibleCopyConfirmed;
        if (visibleCopyUnconfirmed) {
          visibleRecoveryCopyStatus = "unconfirmed";
          LOGGER.warn("identity.google.visible_recovery_copy.unconfirmed", { activationContinues: true });
        }
        LOGGER.info("identity.google.visible_recovery_copy.completed", { status: visibleRecoveryCopyStatus });
      } finally {
        secretKey.value.bytes.fill(0);
      }

      try {
        const activated = await this.#activateIdentity(
          created.value,
          invitation,
          reportProgress,
          googleAccount,
        );
        if (Result.isError(activated)) {
          return failure(activated.error.code, created.value.publicIdentity, visibleRecoveryCopyStatus);
        }

        LOGGER.info("identity.google.create.completed", { visibleRecoveryCopyStatus });
        return Result.ok({
          establishmentMode: "created" as const,
          publicIdentity: created.value.publicIdentity,
          visibleRecoveryCopyStatus,
        });
      } catch {
        LOGGER.warn("identity.google.activation.failed", { code: "unexpected_failure" });
        return failure("unexpected_failure", created.value.publicIdentity, visibleRecoveryCopyStatus);
      }
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
) => Promise<PassportFileStoreResult<void>>;

type CreateVisibleRecoveryCopy = (
  envelope: PassportFileEnvelopeV1,
  publicKeyDisplay: string,
  signal: AbortSignal,
) => Promise<ResultType<void, unknown>>;

async function createVisibleRecoveryCopyBeforeDeadline(
  createVisibleRecoveryCopy: CreateVisibleRecoveryCopy,
  envelope: PassportFileEnvelopeV1,
  publicKeyDisplay: string,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (confirmed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(confirmed);
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish(false);
    }, Math.max(0, timeoutMs));

    void Promise.resolve().then(() => createVisibleRecoveryCopy(envelope, publicKeyDisplay, controller.signal)).then(
      (result) => finish(!Result.isError(result)),
      () => finish(false),
    );
  });
}

function failure<Success>(
  code: CreateGoogleBackedIdentityErrorCode,
  preservedPassportFileIdentity?: PubkyPublicIdentity,
  visibleRecoveryCopyStatus?: "created" | "unconfirmed",
): CreateGoogleBackedIdentityResult<Success> {
  return Result.err({
    code,
    ...(preservedPassportFileIdentity ? { preservedPassportFileIdentity } : {}),
    ...(visibleRecoveryCopyStatus === "unconfirmed" ? { warning: "visible_recovery_copy_unconfirmed" as const } : {}),
  });
}
