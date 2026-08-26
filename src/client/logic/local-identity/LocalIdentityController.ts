import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import type { CodedFailure } from "../../../libs/result";
import type { PubkyHomeserverResolutionResult } from "../pubky/pubkyIdentityKey";
import { PubkySdkAdapter, resolvePubkyHomeserver } from "../pubky/PubkySdkAdapter";
import { createPubkyRingMigrationUrl } from "../pubky/pubkyRingMigration";
import type { LocalIdentityCatalog } from "./localIdentityModels";
import {
  LocalStorageIdentityRepository,
  type LocalIdentityResult,
} from "./LocalStorageIdentityRepository";

export const MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS = 6;
const MAXIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS = 1024;

export type LocalIdentityRecoveryFile = { bytes: Uint8Array; fileName: string };
export type LocalIdentityRecoveryFileErrorCode =
  | "recovery_file_failed"
  | "identity_unavailable"
  | "invalid_password";
export type LocalIdentityRecoveryFileResult = ResultType<
  LocalIdentityRecoveryFile,
  CodedFailure<LocalIdentityRecoveryFileErrorCode>
>;

/** Browser entry point for identities stored in localStorage. */
export class LocalIdentityController {
  private readonly repository: LocalStorageIdentityRepository;

  constructor() {
    try {
      this.repository = new LocalStorageIdentityRepository();
    } catch {
      LOGGER.error("identity.controller.failed", {
        operation: "initialize",
        code: "runtime_exception",
      });
      throw new Error("Local identity initialization unavailable.");
    }
  }

  listIdentities(): LocalIdentityResult<LocalIdentityCatalog> {
    return this.repository.list();
  }

  selectIdentity(publicKeyZ32: string): LocalIdentityResult<void> {
    return this.repository.select(publicKeyZ32);
  }

  removeIdentity(publicKeyZ32: string): LocalIdentityResult<void> {
    return this.repository.remove(publicKeyZ32);
  }

  subscribeToIdentityChanges(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }

  resolveHomeserver(
    publicKeyZ32: string,
  ): Promise<PubkyHomeserverResolutionResult> {
    return resolvePubkyHomeserver(publicKeyZ32);
  }

  async createRecoveryFile(
    publicKeyZ32: string,
    password: string,
  ): Promise<LocalIdentityRecoveryFileResult> {
    if (password.length < MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS
      || password.length > MAXIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS) {
      return Result.err({ code: "invalid_password" });
    }

    const stored = this.repository.read(publicKeyZ32);
    if (Result.isError(stored)) {
      return Result.err({ code: "identity_unavailable", cause: stored.error });
    }

    let pubky: PubkySdkAdapter | undefined;
    try {
      pubky = new PubkySdkAdapter();
      const recoveryFile = pubky.createRecoveryFile(stored.value.secretKey, password);
      return Result.isError(recoveryFile)
        ? Result.err({ code: "recovery_file_failed", cause: recoveryFile.error })
        : Result.ok({
          bytes: recoveryFile.value,
          fileName: `pubky-${publicKeyZ32}.pkarr`,
        });
    } catch (cause) {
      LOGGER.warn("identity.controller.failed", {
        operation: "create_recovery_file",
        code: "recovery_file_failed",
      });
      return Result.err({ code: "recovery_file_failed", cause });
    } finally {
      stored.value.secretKey.bytes.fill(0);
      try {
        pubky?.dispose();
      } catch {
        LOGGER.warn("identity.recovery_file.cleanup.failed", { operation: "pubky_dispose" });
      }
    }
  }

  createPubkyRingMigrationUrl(publicKeyZ32: string): LocalIdentityResult<string> {
    const stored = this.repository.read(publicKeyZ32);
    if (Result.isError(stored)) return Result.err(stored.error);

    try {
      const url = createPubkyRingMigrationUrl(stored.value.secretKey.bytes);
      return url ? Result.ok(url) : Result.err({ code: "invalid_secret_key" });
    } finally {
      stored.value.secretKey.bytes.fill(0);
    }
  }
}
