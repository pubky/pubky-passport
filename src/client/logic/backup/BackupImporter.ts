import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import { LocalStorageIdentityRepository } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { PubkyIdentityKey, PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "@/client/logic/pubky/PubkySdkAdapter";
import { validateBackupInput } from "./BackupVerifier";

export type BackupImportErrorCode =
  | "already_present"
  | "backup_decryption_failed"
  | "external_key"
  | "homeserver_record_found"
  | "import_unavailable"
  | "invalid_backup"
  | "invalid_password"
  | "publish_failed"
  | "resolution_failed"
  | "signin_failed"
  | "storage_failed";

export type BackupImportResult<Success> = ResultType<Success, CodedFailure<BackupImportErrorCode>>;

export type BackupImportOutcome =
  | { status: "imported"; identity: LocalIdentityMetadata }
  /**
   * The key decrypted, but the network holds no homeserver record for it, so sign-in cannot
   * find its account. Nothing was saved; the key waits for {@link BackupImporter.republishHomeserver}.
   */
  | { status: "homeserver_record_missing"; publicIdentity: PubkyPublicIdentity };

type PubkyPort = Pick<
  PubkySdkAdapter,
  | "dispose"
  | "disposeIdentityKey"
  | "exportSecretKey"
  | "publishHomeserver"
  | "resolveHomeserver"
  | "restoreRecoveryFile"
  | "signin"
>;
type RepositoryPort = Pick<LocalStorageIdentityRepository, "list" | "save">;
type SigninResult = Awaited<ReturnType<PubkyPort["signin"]>>;

/**
 * Restores a .pkarr backup into the signing catalog once an SDK sign-in proves its account.
 * Owns every key handle it restores; UI code receives only public identities.
 */
export class BackupImporter {
  private pending: PubkyIdentityKey | undefined;
  private disposed = false;

  constructor(
    private readonly pubky: PubkyPort = new PubkySdkAdapter(),
    private readonly repository: RepositoryPort = new LocalStorageIdentityRepository(),
  ) {}

  /**
   * After a failed sign-in, looks up the key's homeserver record. Only a lookup that finds no
   * record holds the key for {@link republishHomeserver}; a lookup that fails proves nothing and
   * ends the import as `resolution_failed`. `instanceHomeserver` is the homeserver a missing
   * record could point at; without one there is nothing to repair it with, so the failed sign-in
   * ends the import.
   */
  async importBackup(
    recoveryFile: Uint8Array,
    password: string,
    instanceHomeserver: string | null,
  ): Promise<BackupImportResult<BackupImportOutcome>> {
    this.discardPending();
    const invalid = validateBackupInput(recoveryFile, password);
    if (invalid || this.disposed) {
      recoveryFile.fill(0);
      return Result.err({ code: invalid ?? "import_unavailable" });
    }
    const restored = this.pubky.restoreRecoveryFile(recoveryFile, password);
    if (Result.isError(restored)) {
      return Result.err({ code: "backup_decryption_failed", cause: restored.error });
    }

    const identity = restored.value;
    try {
      const absent = this.checkNotSaved(identity.publicIdentity);
      if (Result.isError(absent)) return absent;
      const signedIn = await this.pubky.signin(identity.keyHandle, "normal");
      if (this.disposed) return Result.err({ code: "import_unavailable" });
      if (Result.isError(signedIn) && instanceHomeserver !== null) {
        const record = await this.pubky.resolveHomeserver(identity.publicIdentity.publicKeyZ32);
        if (this.disposed) return Result.err({ code: "import_unavailable" });
        if (Result.isError(record)) {
          return Result.err({ code: "resolution_failed", cause: record.error });
        }
        if (record.value === null) {
          this.pending = identity;
          return Result.ok({
            status: "homeserver_record_missing",
            publicIdentity: identity.publicIdentity,
          });
        }
      }
      const saved = this.save(identity, signedIn);
      return Result.isError(saved)
        ? saved
        : Result.ok({ status: "imported", identity: saved.value });
    } finally {
      if (this.pending !== identity) this.pubky.disposeIdentityKey(identity.keyHandle);
    }
  }

  /**
   * Publishes `homeserverPubky` as the pending key's homeserver, then signs in and saves the key.
   * Call it only after the person confirmed that homeserver. The record is looked up again first,
   * because another signer may have republished it since the import found none: a record for
   * that homeserver is kept as it is, and a record for any other homeserver ends the repair as
   * `homeserver_record_found` without publishing. A failed attempt otherwise keeps the key, so
   * the person can retry or leave.
   */
  async republishHomeserver(
    homeserverPubky: string,
  ): Promise<BackupImportResult<LocalIdentityMetadata>> {
    const identity = this.pending;
    if (!identity) return Result.err({ code: "import_unavailable" });
    const record = await this.pubky.resolveHomeserver(identity.publicIdentity.publicKeyZ32);
    if (this.pending !== identity) return Result.err({ code: "import_unavailable" });
    if (Result.isError(record)) {
      return Result.err({ code: "resolution_failed", cause: record.error });
    }
    if (record.value !== null && record.value !== homeserverPubky) {
      this.discardPending();
      return Result.err({ code: "homeserver_record_found" });
    }
    if (record.value === null) {
      const published = await this.pubky.publishHomeserver(identity.keyHandle, homeserverPubky);
      if (this.pending !== identity) return Result.err({ code: "import_unavailable" });
      if (Result.isError(published)) {
        return Result.err({ code: "publish_failed", cause: published.error });
      }
    }
    const signedIn = await this.pubky.signin(identity.keyHandle, "after-publication");
    if (this.pending !== identity) return Result.err({ code: "import_unavailable" });
    // Signing in against that record proves the account lives there, so the identity remembers it.
    const saved = this.save(identity, signedIn, homeserverPubky);
    if (Result.isOk(saved)) this.discardPending();
    return saved;
  }

  /** Forgets a key that is waiting for a homeserver record. */
  discardPending(): void {
    const identity = this.pending;
    this.pending = undefined;
    if (identity) this.pubky.disposeIdentityKey(identity.keyHandle);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.discardPending();
    try {
      this.pubky.dispose();
    } catch (e) {
      LOGGER.warn("identity.backup_import.cleanup.failed", {
        operation: "pubky_dispose",
        ...safeErrorLogFields(e),
      });
    }
  }

  /** An import never overwrites a saved entry; a Ring entry keeps its key outside Passport. */
  private checkNotSaved(publicIdentity: PubkyPublicIdentity): BackupImportResult<void> {
    const catalog = this.repository.list();
    if (Result.isError(catalog))
      return Result.err({ code: "storage_failed", cause: catalog.error });
    const existing = catalog.value.identities.find(
      (candidate) => candidate.publicIdentity.publicKeyZ32 === publicIdentity.publicKeyZ32,
    );
    if (!existing) return Result.ok();
    return Result.err({ code: existing.keySource === "ring" ? "external_key" : "already_present" });
  }

  /** `homeserverPubky` is the homeserver this import published; a plain sign-in does not know it. */
  private save(
    identity: PubkyIdentityKey,
    signedIn: SigninResult,
    homeserverPubky?: string,
  ): BackupImportResult<LocalIdentityMetadata> {
    if (
      Result.isError(signedIn) ||
      signedIn.value.publicIdentity.publicKeyZ32 !== identity.publicIdentity.publicKeyZ32
    ) {
      return Result.err({
        code: "signin_failed",
        ...(Result.isError(signedIn) ? { cause: signedIn.error } : {}),
      });
    }
    // Another tab may have saved the same key while this one was signing in.
    const absent = this.checkNotSaved(identity.publicIdentity);
    if (Result.isError(absent)) return absent;
    const secret = this.pubky.exportSecretKey(identity.keyHandle);
    if (Result.isError(secret)) return Result.err({ code: "storage_failed", cause: secret.error });
    try {
      const saved = this.repository.save(
        {
          publicIdentity: identity.publicIdentity,
          ...(homeserverPubky ? { homeserverPubky } : {}),
          // The file just opened with its password, so this key has a checked backup.
          backup: { verifiedAt: new Date().toISOString() },
        },
        secret.value,
      );
      return Result.isError(saved)
        ? Result.err({ code: "storage_failed", cause: saved.error })
        : Result.ok(saved.value);
    } finally {
      secret.value.bytes.fill(0);
    }
  }
}
