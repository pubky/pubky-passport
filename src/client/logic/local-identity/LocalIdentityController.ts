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

type LocalIdentityRepository = Pick<
  LocalStorageIdentityRepository,
  "list" | "read" | "remove" | "select" | "subscribe"
>;

export type LocalIdentityDependencies = {
  createPubky: () => Pick<PubkySdkAdapter, "createRecoveryFile" | "dispose">;
  repository: LocalIdentityRepository;
  resolveHomeserver: (publicKeyZ32: string) => Promise<PubkyHomeserverResolutionResult>;
};

export type LocalIdentityService = {
  createPubkyRingMigrationUrl: (publicKeyZ32: string) => LocalIdentityResult<string>;
  createRecoveryFile: (
    publicKeyZ32: string,
    password: string,
  ) => Promise<LocalIdentityRecoveryFileResult>;
  listIdentities: () => LocalIdentityResult<LocalIdentityCatalog>;
  removeIdentity: (publicKeyZ32: string) => LocalIdentityResult<void>;
  resolveHomeserver: (publicKeyZ32: string) => Promise<PubkyHomeserverResolutionResult>;
  selectIdentity: (publicKeyZ32: string) => LocalIdentityResult<void>;
  subscribeToIdentityChanges: (listener: () => void) => () => void;
};

export function createLocalIdentityService(
  dependencies: LocalIdentityDependencies = browserDependencies(),
): LocalIdentityService {
  const { repository } = dependencies;
  return {
    createPubkyRingMigrationUrl: (publicKeyZ32) => createMigrationUrl(repository, publicKeyZ32),
    createRecoveryFile: (publicKeyZ32, password) => createRecoveryFile(
      dependencies,
      publicKeyZ32,
      password,
    ),
    listIdentities: () => repository.list(),
    removeIdentity: (publicKeyZ32) => repository.remove(publicKeyZ32),
    resolveHomeserver: dependencies.resolveHomeserver,
    selectIdentity: (publicKeyZ32) => repository.select(publicKeyZ32),
    subscribeToIdentityChanges: (listener) => repository.subscribe(listener),
  };
}

async function createRecoveryFile(
  dependencies: LocalIdentityDependencies,
  publicKeyZ32: string,
  password: string,
): Promise<LocalIdentityRecoveryFileResult> {
  if (password.length < MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS
    || password.length > MAXIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS) {
    return Result.err({ code: "invalid_password" });
  }

  const stored = dependencies.repository.read(publicKeyZ32);
  if (Result.isError(stored)) {
    return Result.err({ code: "identity_unavailable", cause: stored.error });
  }

  let pubky: ReturnType<LocalIdentityDependencies["createPubky"]> | undefined;
  try {
    pubky = dependencies.createPubky();
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

function createMigrationUrl(
  repository: LocalIdentityRepository,
  publicKeyZ32: string,
): LocalIdentityResult<string> {
  const stored = repository.read(publicKeyZ32);
  if (Result.isError(stored)) return Result.err(stored.error);

  try {
    const url = createPubkyRingMigrationUrl(stored.value.secretKey.bytes);
    return url ? Result.ok(url) : Result.err({ code: "invalid_secret_key" });
  } finally {
    stored.value.secretKey.bytes.fill(0);
  }
}

function browserDependencies(): LocalIdentityDependencies {
  return {
    createPubky: () => new PubkySdkAdapter(),
    repository: new LocalStorageIdentityRepository(),
    resolveHomeserver: resolvePubkyHomeserver,
  };
}
