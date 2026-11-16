import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import type {
  PubkyHomeserverResolutionResult,
  PubkyIdentityKey,
  PubkyIdentityKeyHandle,
  PubkyPublicIdentity,
} from "@/client/logic/pubky/pubkyIdentityKey";
import type {
  PubkyAuthorizedApp,
  PubkyRingMigration,
  PubkySdkAdapter,
} from "@/client/logic/pubky/PubkySdkAdapter";
import type { LocalIdentityCatalog } from "./localIdentityModels";
import {
  LocalStorageIdentityRepository,
  type LocalIdentityResult,
} from "./LocalStorageIdentityRepository";

export const MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS = 6;
const MAXIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS = 1024;

export type LocalIdentityRecoveryFile = { bytes: Uint8Array; fileName: string };
type LocalIdentityRecoveryFileErrorCode =
  "recovery_file_failed" | "identity_unavailable" | "invalid_password";
export type LocalIdentityRecoveryFileResult = ResultType<
  LocalIdentityRecoveryFile,
  CodedFailure<LocalIdentityRecoveryFileErrorCode>
>;
type LocalIdentityHomeserverRepublishErrorCode = "publication_failed" | "identity_unavailable";
export type LocalIdentityHomeserverRepublishResult = ResultType<
  void,
  CodedFailure<LocalIdentityHomeserverRepublishErrorCode>
>;

type LocalIdentityAuthorizedAppsErrorCode = "authorized_apps_unavailable" | "identity_unavailable";
export type LocalIdentityAuthorizedAppsResult = ResultType<
  readonly PubkyAuthorizedApp[],
  CodedFailure<LocalIdentityAuthorizedAppsErrorCode>
>;
type LocalIdentityAuthorizedAppRevocationErrorCode = "identity_unavailable" | "revocation_failed";
export type LocalIdentityAuthorizedAppRevocationResult = ResultType<
  void,
  CodedFailure<LocalIdentityAuthorizedAppRevocationErrorCode>
>;

/** An existing identity to bring into this browser. Nothing here is sent to Passport's server. */
export type LocalIdentityImportSource =
  | Readonly<{ kind: "recovery-file"; bytes: Uint8Array; password: string }>
  | Readonly<{ kind: "recovery-phrase"; words: readonly string[] }>;
export type LocalIdentityImport = Readonly<{
  publicIdentity: PubkyPublicIdentity;
  /** The identity was already in this browser; it was selected, not saved again. */
  alreadyStored: boolean;
}>;
export type LocalIdentityImportErrorCode =
  | "homeserver_not_found"
  | "homeserver_unreachable"
  | "import_failed"
  | "invalid_recovery_file"
  | "invalid_recovery_phrase"
  | "recovery_file_undecryptable"
  | "signin_failed"
  | "storage_unavailable";
export type LocalIdentityImportResult = ResultType<
  LocalIdentityImport,
  CodedFailure<LocalIdentityImportErrorCode>
>;

type LocalIdentityRepositoryPort = Pick<
  LocalStorageIdentityRepository,
  "list" | "select" | "remove" | "subscribe" | "read" | "saveIfAbsent"
>;

/** How long an import may wait for the homeserver lookup and sign-in together. */
const IMPORT_NETWORK_TIMEOUT_MS = 30_000;

/**
 * Browser entry point for identities stored in localStorage.
 *
 * Optional `repository` replaces {@link LocalStorageIdentityRepository}.
 * Production omits it.
 */
export class LocalIdentityController {
  private readonly repository: LocalIdentityRepositoryPort;
  private readonly importNetworkTimeoutMs: number;

  constructor(
    repository?: LocalIdentityRepositoryPort,
    {
      importNetworkTimeoutMs = IMPORT_NETWORK_TIMEOUT_MS,
    }: { importNetworkTimeoutMs?: number } = {},
  ) {
    this.repository = repository ?? new LocalStorageIdentityRepository();
    this.importNetworkTimeoutMs = importNetworkTimeoutMs;
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

  async resolveHomeserver(publicKeyZ32: string): Promise<PubkyHomeserverResolutionResult> {
    try {
      const { resolvePubkyHomeserver } = await import("@/client/logic/pubky/PubkySdkAdapter");
      return await resolvePubkyHomeserver(publicKeyZ32);
    } catch (e) {
      return Result.err({ code: "resolution_failed", cause: e });
    }
  }

  async republishHomeserver(publicKeyZ32: string): Promise<LocalIdentityHomeserverRepublishResult> {
    return this.withRestoredIdentity(
      publicKeyZ32,
      "republish_homeserver",
      "publication_failed",
      (pubky, keyHandle) => pubky.publishHomeserver(keyHandle),
    );
  }

  async listAuthorizedApps(publicKeyZ32: string): Promise<LocalIdentityAuthorizedAppsResult> {
    return this.withRestoredIdentity(
      publicKeyZ32,
      "list_authorized_apps",
      "authorized_apps_unavailable",
      (pubky, keyHandle) => pubky.listAuthorizedApps(keyHandle),
    );
  }

  async revokeAuthorizedApp(
    publicKeyZ32: string,
    grantId: string,
  ): Promise<LocalIdentityAuthorizedAppRevocationResult> {
    return this.withRestoredIdentity(
      publicKeyZ32,
      "revoke_authorized_app",
      "revocation_failed",
      (pubky, keyHandle) => pubky.revokeAuthorizedApp(keyHandle, grantId),
    );
  }

  async createRecoveryFile(
    publicKeyZ32: string,
    password: string,
  ): Promise<LocalIdentityRecoveryFileResult> {
    if (
      password.length < MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS ||
      password.length > MAXIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS
    ) {
      return Result.err({ code: "invalid_password" });
    }

    const stored = this.repository.read(publicKeyZ32);
    if (Result.isError(stored)) {
      return Result.err({ code: "identity_unavailable", cause: stored.error });
    }

    let pubky: PubkySdkAdapter | undefined;
    try {
      const { PubkySdkAdapter } = await import("@/client/logic/pubky/PubkySdkAdapter");
      pubky = new PubkySdkAdapter();
      const recoveryFile = pubky.createRecoveryFile(stored.value.secretKey, publicKeyZ32, password);
      return Result.isError(recoveryFile)
        ? Result.err({ code: "recovery_file_failed", cause: recoveryFile.error })
        : Result.ok({
            bytes: recoveryFile.value,
            fileName: `pubky-${publicKeyZ32}.pkarr`,
          });
    } catch (e) {
      LOGGER.warn("identity.controller.failed", {
        operation: "create_recovery_file",
        code: "recovery_file_failed",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "recovery_file_failed", cause: e });
    } finally {
      stored.value.secretKey.bytes.fill(0);
      try {
        pubky?.dispose();
      } catch (e) {
        LOGGER.warn("identity.recovery_file.cleanup.failed", {
          operation: "pubky_dispose",
          ...safeErrorLogFields(e),
        });
      }
    }
  }

  /**
   * Brings an existing identity into this browser from a recovery file or a recovery phrase.
   *
   * The key signs in to the homeserver its PKARR record already names; there is no signup and no
   * homeserver choice. Only after that sign-in works is the identity saved, browser-only, with no
   * Google or Apple account. An identity this browser already holds is selected, never overwritten,
   * so an existing provider link stays. `onKeyRecovered` reports the public key before sign-in.
   */
  async importIdentity(
    source: LocalIdentityImportSource,
    onKeyRecovered?: (publicIdentity: PubkyPublicIdentity) => void,
  ): Promise<LocalIdentityImportResult> {
    let pubky: PubkySdkAdapter | undefined;
    // A sign-in that outlives the deadline keeps the adapter until it settles.
    let lateSignin: Promise<unknown> | undefined;
    try {
      const { PubkySdkAdapter } = await import("@/client/logic/pubky/PubkySdkAdapter");
      pubky = new PubkySdkAdapter();
      const recovered = await recoverIdentityKey(pubky, source);
      if (Result.isError(recovered)) return Result.err(recovered.error);
      const { keyHandle, publicIdentity } = recovered.value;
      onKeyRecovered?.(publicIdentity);

      const stored = this.selectIfStored(publicIdentity);
      if (Result.isError(stored)) return Result.err(stored.error);
      if (stored.value) return Result.ok({ publicIdentity, alreadyStored: true });

      const signin = signInWithPublishedHomeserver(pubky, keyHandle, publicIdentity);
      const signedIn = await beforeDeadline(signin, this.importNetworkTimeoutMs);
      if (signedIn === TIMED_OUT) {
        lateSignin = signin;
        return Result.err({ code: "homeserver_unreachable" });
      }
      if (Result.isError(signedIn)) return Result.err(signedIn.error);

      const secretKey = pubky.exportSecretKey(keyHandle);
      if (Result.isError(secretKey)) {
        return Result.err({ code: "import_failed", cause: secretKey.error });
      }
      let saved: LocalIdentityResult<"saved" | "already-stored">;
      try {
        saved = this.repository.saveIfAbsent({ publicIdentity }, secretKey.value);
      } finally {
        secretKey.value.bytes.fill(0);
      }
      if (Result.isError(saved)) {
        return Result.err({ code: "storage_unavailable", cause: saved.error });
      }
      if (saved.value === "saved") return Result.ok({ publicIdentity, alreadyStored: false });

      // Another tab stored this identity during sign-in; its record stays as it is.
      const selected = this.repository.select(publicIdentity.publicKeyZ32);
      return Result.isError(selected)
        ? Result.err({ code: "storage_unavailable", cause: selected.error })
        : Result.ok({ publicIdentity, alreadyStored: true });
    } catch (e) {
      LOGGER.warn("identity.controller.failed", {
        operation: "import_identity",
        code: "import_failed",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "import_failed", cause: e });
    } finally {
      if (source.kind === "recovery-file") source.bytes.fill(0);
      const dispose = () => {
        try {
          pubky?.dispose();
        } catch (e) {
          LOGGER.warn("identity.controller.cleanup.failed", {
            operation: "import_identity",
            stage: "pubky_dispose",
            ...safeErrorLogFields(e),
          });
        }
      };
      if (lateSignin) void lateSignin.then(dispose, dispose);
      else dispose();
    }
  }

  /** Selects the identity when this browser already holds it. */
  private selectIfStored(
    publicIdentity: PubkyPublicIdentity,
  ): ResultType<boolean, CodedFailure<"storage_unavailable">> {
    const catalog = this.repository.list();
    if (Result.isError(catalog)) {
      return Result.err({ code: "storage_unavailable", cause: catalog.error });
    }
    const stored = catalog.value.identities.some(
      (identity) => identity.publicIdentity.publicKeyZ32 === publicIdentity.publicKeyZ32,
    );
    if (!stored) return Result.ok(false);
    const selected = this.repository.select(publicIdentity.publicKeyZ32);
    return Result.isError(selected)
      ? Result.err({ code: "storage_unavailable", cause: selected.error })
      : Result.ok(true);
  }

  async createPubkyRingMigration(
    publicKeyZ32: string,
  ): Promise<LocalIdentityResult<PubkyRingMigration>> {
    const stored = this.repository.read(publicKeyZ32);
    if (Result.isError(stored)) return Result.err(stored.error);

    try {
      const { PubkySdkAdapter } = await import("@/client/logic/pubky/PubkySdkAdapter");
      const migration = PubkySdkAdapter.createPubkyRingMigration(
        stored.value.secretKey,
        publicKeyZ32,
      );
      return Result.isOk(migration)
        ? Result.ok(migration.value)
        : Result.err({ code: "invalid_secret_key", cause: migration.error });
    } catch (e) {
      return Result.err({ code: "invalid_secret_key", cause: e });
    } finally {
      stored.value.secretKey.bytes.fill(0);
    }
  }

  /**
   * Restores the stored key into a short-lived SDK adapter for one operation, then clears the key
   * bytes and disposes the adapter. Every failure after the identity is read maps to `failureCode`.
   */
  private async withRestoredIdentity<Success, FailureCode extends string>(
    publicKeyZ32: string,
    operation: "list_authorized_apps" | "republish_homeserver" | "revoke_authorized_app",
    failureCode: FailureCode,
    action: (
      pubky: PubkySdkAdapter,
      keyHandle: PubkyIdentityKeyHandle,
    ) => Promise<ResultType<Success, CodedFailure<string>>>,
  ): Promise<ResultType<Success, CodedFailure<FailureCode | "identity_unavailable">>> {
    const stored = this.repository.read(publicKeyZ32);
    if (Result.isError(stored)) {
      return Result.err({ code: "identity_unavailable", cause: stored.error });
    }

    let pubky: PubkySdkAdapter | undefined;
    try {
      const { PubkySdkAdapter } = await import("@/client/logic/pubky/PubkySdkAdapter");
      pubky = new PubkySdkAdapter();
      const restored = pubky.restoreIdentityKey(stored.value.secretKey);
      if (Result.isError(restored)) {
        return Result.err({ code: failureCode, cause: restored.error });
      }
      if (restored.value.publicIdentity.publicKeyZ32 !== publicKeyZ32) {
        return Result.err({ code: failureCode });
      }
      const result = await action(pubky, restored.value.keyHandle);
      return Result.isError(result)
        ? Result.err({ code: failureCode, cause: result.error })
        : Result.ok(result.value);
    } catch (e) {
      LOGGER.warn("identity.controller.failed", {
        operation,
        code: failureCode,
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: failureCode, cause: e });
    } finally {
      stored.value.secretKey.bytes.fill(0);
      try {
        pubky?.dispose();
      } catch (e) {
        LOGGER.warn("identity.controller.cleanup.failed", {
          operation,
          stage: "pubky_dispose",
          ...safeErrorLogFields(e),
        });
      }
    }
  }
}

async function recoverIdentityKey(
  pubky: PubkySdkAdapter,
  source: LocalIdentityImportSource,
): Promise<
  ResultType<
    PubkyIdentityKey,
    CodedFailure<
      | "import_failed"
      | "invalid_recovery_file"
      | "invalid_recovery_phrase"
      | "recovery_file_undecryptable"
    >
  >
> {
  if (source.kind === "recovery-file") {
    const imported = pubky.importRecoveryFile(source.bytes, source.password);
    if (Result.isOk(imported)) return Result.ok(imported.value);
    switch (imported.error.code) {
      case "invalid_recovery_file":
      case "recovery_file_undecryptable":
        return Result.err({ code: imported.error.code });
      case "key_unavailable":
        return Result.err({ code: "import_failed", cause: imported.error });
    }
  }

  const { deriveSecretKeyFromRecoveryPhrase } =
    await import("@/client/logic/identity-import/recoveryPhrase");
  const secretKey = await deriveSecretKeyFromRecoveryPhrase(source.words);
  if (Result.isError(secretKey)) return Result.err({ code: "invalid_recovery_phrase" });
  // restoreIdentityKey clears the secret key bytes.
  const restored = pubky.restoreIdentityKey(secretKey.value);
  return Result.isError(restored)
    ? Result.err({ code: "import_failed", cause: restored.error })
    : Result.ok(restored.value);
}

const TIMED_OUT = Symbol("timed out");

async function beforeDeadline<Value>(
  promise: Promise<Value>,
  timeoutMs: number,
): Promise<Value | typeof TIMED_OUT> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timeout = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/**
 * Signs in to the homeserver the key's PKARR record names. A key without a record is
 * `homeserver_not_found`; nothing is signed up. Settles as a Result and never rejects.
 */
async function signInWithPublishedHomeserver(
  pubky: PubkySdkAdapter,
  keyHandle: PubkyIdentityKeyHandle,
  publicIdentity: PubkyPublicIdentity,
): Promise<
  ResultType<
    void,
    CodedFailure<"homeserver_not_found" | "homeserver_unreachable" | "signin_failed">
  >
> {
  try {
    const homeserver = await pubky.resolveHomeserver(publicIdentity.publicKeyZ32);
    if (Result.isError(homeserver)) {
      return Result.err({ code: "homeserver_unreachable", cause: homeserver.error });
    }
    if (homeserver.value === null) return Result.err({ code: "homeserver_not_found" });

    const signin = await pubky.signin(keyHandle, "normal");
    if (Result.isError(signin)) return Result.err({ code: "signin_failed", cause: signin.error });
    return signin.value.publicIdentity.publicKeyZ32 === publicIdentity.publicKeyZ32
      ? Result.ok()
      : Result.err({ code: "signin_failed" });
  } catch (e) {
    return Result.err({ code: "signin_failed", cause: e });
  }
}
