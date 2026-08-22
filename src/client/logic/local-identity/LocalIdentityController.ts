import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import type { PubkyHomeserverResolutionResult } from "../pubky/pubkyIdentityKey";
import { PubkySdkAdapter, resolvePubkyHomeserver } from "../pubky/PubkySdkAdapter";
import type { LocalIdentityCatalog } from "./localIdentityModels";
import type { LocalIdentityResult } from "./LocalStorageIdentityRepository";
import { LocalStorageIdentityRepository } from "./LocalStorageIdentityRepository";

export const MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS = 6;
const MAXIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS = 1024;

export type LocalIdentityRecoveryFile = { bytes: Uint8Array; fileName: string };
export type LocalIdentityRecoveryFileErrorCode =
  | "recovery_file_failed"
  | "identity_unavailable"
  | "invalid_password";
export type LocalIdentityRecoveryFileResult = ResultType<
  LocalIdentityRecoveryFile,
  { code: LocalIdentityRecoveryFileErrorCode }
>;

/**
 * Browser entry point for identities stored in localStorage. This class is safe to use in a React client component.
 */
export class LocalIdentityController {
  private repository: LocalStorageIdentityRepository;

  constructor() {
    try {
      this.repository = new LocalStorageIdentityRepository();
    } catch (error) {
      LOGGER.error("identity.controller.failed", {
        operation: "initialize",
        code: "runtime_exception",
      });
      throw error;
    }
  }

  /** Returns a list of all identities stored in localStorage without exposing secret key bytes. */
  listIdentities(): LocalIdentityResult<LocalIdentityCatalog> {
    return this.repository.list();
  }

  /** Makes an existing local identity active for Passport authorization. */
  selectIdentity(publicKeyZ32: string): LocalIdentityResult<void> {
    return this.repository.select(publicKeyZ32);
  }

  /**
   * Removes one identity from this browser only.
   *
   * This does not delete Google Drive Passport files. Use the Google identity flow for
   * detachment.
   */
  removeIdentity(publicKeyZ32: string): LocalIdentityResult<void> {
    return this.repository.remove(publicKeyZ32);
  }

  resolveHomeserver = (
    publicKeyZ32: string,
  ): Promise<PubkyHomeserverResolutionResult> => resolvePubkyHomeserver(publicKeyZ32);

  /** Creates a password-encrypted recovery file for the requested identity. */
  createRecoveryFile = async (
    publicKeyZ32: string,
    password: string,
  ): Promise<LocalIdentityRecoveryFileResult> => {
    if (password.length < MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS
      || password.length > MAXIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS) {
      return Result.err({ code: "invalid_password" });
    }

    const stored = this.repository.read(publicKeyZ32);
    if (Result.isError(stored)) return Result.err({ code: "identity_unavailable" });

    let pubky: PubkySdkAdapter | undefined;
    try {
      pubky = new PubkySdkAdapter();
      const recoveryFile = pubky.createRecoveryFile(stored.value.secretKey, password);
      if (Result.isError(recoveryFile)) return Result.err({ code: "recovery_file_failed" });
      return Result.ok({
        bytes: recoveryFile.value,
        fileName: `pubky-${publicKeyZ32}.pkarr`,
      });
    } catch {
      return Result.err({ code: "recovery_file_failed" });
    } finally {
      stored.value.secretKey.bytes.fill(0);
      try {
        pubky?.dispose();
      } catch {
        LOGGER.warn("identity.recovery_file.cleanup.failed", { operation: "pubky_dispose" });
      }
    }
  };

  /**
   * Creates a Pubky Ring migration URL for the requested identity.
   *
   * The explicit key binds the export to the identity shown by the caller. The
   * active identity can change in another tab while a management flow is open.
   */
  createPubkyRingMigrationUrl(publicKeyZ32: string): LocalIdentityResult<string> {
    const stored = this.repository.read(publicKeyZ32);
    if (Result.isError(stored)) return Result.err(stored.error);

    try {
      const secretKey = Array.from(
        stored.value.secretKey.bytes,
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      return Result.ok(`pubkyring://migrate?index=0&total=1&key=${secretKey}`);
    } finally {
      stored.value.secretKey.bytes.fill(0);
    }
  }
}
