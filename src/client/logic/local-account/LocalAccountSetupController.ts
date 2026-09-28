import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { BackupVerifier, isValidNewBackupPassword } from "@/client/logic/backup/BackupVerifier";
import type { CodedFailure } from "@/libs/result";
import type { HomeserverSignupDetails } from "@/client/logic/signup/homeserverInvite";
import { LocalStorageIdentityRepository } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type {
  PubkyIdentityKey,
  PubkySecretKeyMaterial,
} from "@/client/logic/pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "@/client/logic/pubky/PubkySdkAdapter";
import { SignupTokenChecker } from "@/client/logic/pubky/SignupTokenChecker";
import { LocalAccountDraftRepository, type LocalAccountDraft } from "./LocalAccountDraftRepository";

export type LocalAccountRegistrationProgress = "signing_up" | "publishing" | "activating";

export type LocalAccountSetupErrorCode =
  | "backup_decryption_failed"
  | "backup_mismatch"
  | "backup_not_verified"
  | "create_failed"
  | "draft_storage_failed"
  | "external_key"
  /** The homeserver did not answer before the invite was submitted; nothing was sent. */
  | "homeserver_unreachable"
  | "invalid_backup"
  | "invalid_password"
  | "invite_rejected"
  | "registration_failed"
  | "registration_started"
  | "signin_failed"
  | "storage_failed";

export type LocalAccountSetupResult<Success> = ResultType<
  Success,
  CodedFailure<LocalAccountSetupErrorCode>
>;

type CatalogPort = Pick<LocalStorageIdentityRepository, "list">;

/**
 * Reads the unfinished local account without writing storage, so render code may call it. A
 * draft whose key is already in the signing catalog finished registering: it counts as no
 * unfinished account, and {@link releaseFinishedAccount} removes it.
 */
export function readUnfinishedAccount(
  drafts: Pick<LocalAccountDraftRepository, "read"> = new LocalAccountDraftRepository(),
  repository: CatalogPort = new LocalStorageIdentityRepository(),
): ReturnType<LocalAccountDraftRepository["read"]> {
  const saved = drafts.read();
  if (Result.isError(saved) || !saved.value) return saved;
  return isDraftRegistered(saved.value, repository) ? Result.ok(null) : saved;
}

/**
 * Removes a draft that outlived its finished registration, so it no longer blocks choosing a
 * signer or changing the invite. Writes storage: call it from an effect or event handler, never
 * during render. An unfinished draft is left alone.
 */
export function releaseFinishedAccount(
  drafts: Pick<LocalAccountDraftRepository, "read" | "remove"> = new LocalAccountDraftRepository(),
  repository: CatalogPort = new LocalStorageIdentityRepository(),
): void {
  const saved = drafts.read();
  if (Result.isOk(saved) && saved.value) releaseRegisteredDraft(saved.value, drafts, repository);
}

function isDraftRegistered(draft: LocalAccountDraft, repository: CatalogPort): boolean {
  const catalog = repository.list();
  return (
    Result.isOk(catalog) &&
    catalog.value.identities.some(
      (entry) => entry.publicIdentity.publicKeyZ32 === draft.publicIdentity.publicKeyZ32,
    )
  );
}

/**
 * Removes a draft whose key already signs from the catalog: registration finished but the
 * draft outlived it. Returns false when the draft is still unfinished or could not be removed.
 */
function releaseRegisteredDraft(
  draft: LocalAccountDraft,
  drafts: Pick<LocalAccountDraftRepository, "remove">,
  repository: CatalogPort,
): boolean {
  if (!isDraftRegistered(draft, repository)) return false;
  const removed = drafts.remove(draft.publicIdentity.publicKeyZ32);
  if (Result.isError(removed)) {
    LOGGER.warn("identity.local_account.cleanup.failed", {
      operation: "release_registered_draft",
      code: removed.error.code,
    });
    return false;
  }
  return true;
}

type PubkyPort = Pick<
  PubkySdkAdapter,
  | "createIdentityKey"
  | "createRecoveryFile"
  | "dispose"
  | "disposeIdentityKey"
  | "exportSecretKey"
  | "publishHomeserver"
  | "restoreIdentityKey"
  | "restoreRecoveryFile"
  | "signin"
  | "signup"
>;

type RepositoryPort = Pick<LocalStorageIdentityRepository, "list" | "save">;
type DraftPort = Pick<
  LocalAccountDraftRepository,
  "restore" | "create" | "setStep" | "markRegistrationStarted" | "discardUnregistered" | "remove"
>;
type InviteLookupPort = Pick<SignupTokenChecker, "lookUp">;

/**
 * Owns all SDK key handles used by local account setup. UI code receives only public
 * identities and encrypted backup bytes. Passwords are method arguments, and temporary
 * plaintext key buffers are cleared by the adapter.
 */
export class LocalAccountSetupController {
  private identity: PubkyIdentityKey | undefined;
  private invite: HomeserverSignupDetails | undefined;
  private backupCreated = false;
  private backupVerified = false;
  private verificationSkipped = false;
  private disposed = false;
  private step: LocalAccountDraft["step"] = "password";
  private registrationStarted = false;
  private readonly requests = new AbortController();

  constructor(
    private readonly pubky: PubkyPort = new PubkySdkAdapter(),
    private readonly repository: RepositoryPort = new LocalStorageIdentityRepository(),
    private readonly drafts: DraftPort = new LocalAccountDraftRepository(),
    private readonly invites: InviteLookupPort = new SignupTokenChecker(),
  ) {}

  get preparedStep(): LocalAccountDraft["step"] {
    return this.step;
  }

  /** True once the invite has been submitted at least once; the key may then own an account. */
  get hasStartedRegistration(): boolean {
    return this.registrationStarted;
  }

  prepareAccount(invite: HomeserverSignupDetails): LocalAccountSetupResult<LocalIdentityMetadata> {
    if (this.disposed || this.identity) return Result.err({ code: "create_failed" });
    const saved = this.drafts.restore();
    if (Result.isError(saved)) return Result.err({ code: "storage_failed", cause: saved.error });
    if (saved.value && !releaseRegisteredDraft(saved.value.draft, this.drafts, this.repository))
      return this.resumeDraft(saved.value, invite);
    saved.value?.secretKey.bytes.fill(0);
    return this.createDraft(invite);
  }

  /**
   * Forgets the prepared key while its invite has not been submitted. Once registration has
   * started the draft is kept and `registration_started` is returned; use `abandonAccount`.
   */
  discardUnregistered(): LocalAccountSetupResult<void> {
    if (!this.identity) return Result.ok();
    if (this.registrationStarted) return Result.err({ code: "registration_started" });
    const discarded = this.drafts.discardUnregistered();
    if (Result.isError(discarded)) {
      return Result.err({
        code: discarded.error.code === "draft_conflict" ? "registration_started" : "storage_failed",
        cause: discarded.error,
      });
    }
    this.forgetIdentity();
    return Result.ok();
  }

  /**
   * Explicitly drops a setup whose invite may already have been consumed. The key is removed
   * from this browser; only a downloaded backup can bring it back afterwards.
   */
  abandonAccount(): LocalAccountSetupResult<void> {
    if (!this.identity) return Result.ok();
    const removed = this.drafts.remove(this.identity.publicIdentity.publicKeyZ32);
    if (Result.isError(removed))
      return Result.err({ code: "storage_failed", cause: removed.error });
    this.forgetIdentity();
    return Result.ok();
  }

  returnToBackup(): LocalAccountSetupResult<void> {
    if (!this.identity) return Result.err({ code: "create_failed" });
    const updated = this.drafts.setStep(this.identity.publicIdentity.publicKeyZ32, "password");
    if (Result.isError(updated))
      return Result.err({ code: "storage_failed", cause: updated.error });
    this.step = "password";
    this.backupCreated = false;
    this.backupVerified = false;
    this.verificationSkipped = false;
    return Result.ok();
  }

  createBackup(password: string): LocalAccountSetupResult<{ bytes: Uint8Array; fileName: string }> {
    if (!this.identity) return Result.err({ code: "create_failed" });
    if (!isValidNewBackupPassword(password)) return Result.err({ code: "invalid_password" });

    const secret = this.pubky.exportSecretKey(this.identity.keyHandle);
    if (Result.isError(secret)) return Result.err({ code: "create_failed", cause: secret.error });
    const recovery = this.pubky.createRecoveryFile(
      secret.value,
      this.identity.publicIdentity.publicKeyZ32,
      password,
    );
    if (Result.isError(recovery)) {
      return Result.err({ code: "create_failed", cause: recovery.error });
    }
    const updated = this.drafts.setStep(this.identity.publicIdentity.publicKeyZ32, "confirm");
    if (Result.isError(updated)) {
      recovery.value.fill(0);
      return Result.err({ code: "storage_failed", cause: updated.error });
    }
    this.step = "confirm";
    this.backupCreated = true;
    this.backupVerified = false;
    this.verificationSkipped = false;
    return Result.ok({
      bytes: recovery.value,
      fileName: `pubky-${this.identity.publicIdentity.publicKeyZ32}.pkarr`,
    });
  }

  verifyBackup(
    recoveryFile: Uint8Array,
    password: string,
  ): LocalAccountSetupResult<LocalIdentityMetadata> {
    if (!this.identity) {
      recoveryFile.fill(0);
      return Result.err({ code: "create_failed" });
    }
    const verified = new BackupVerifier(this.pubky).verify(
      recoveryFile,
      password,
      this.identity.publicIdentity.publicKeyZ32,
    );
    if (Result.isError(verified)) return verified;
    this.backupVerified = true;
    return Result.ok({ publicIdentity: this.identity.publicIdentity });
  }

  /**
   * Skipping the file check is allowed only for a backup this instance encrypted, whose
   * password the UI had confirmed twice. A setup resumed from its draft must verify the file.
   */
  skipVerification(): LocalAccountSetupResult<void> {
    if (!this.identity || !this.backupCreated) return Result.err({ code: "backup_not_verified" });
    this.verificationSkipped = true;
    return Result.ok();
  }

  /**
   * Registers and activates the prepared identity. Every retry reuses the same key;
   * account-exists and uncertain signup outcomes are reconciled through publication
   * and blocking sign-in before local storage is updated. A read-only invite lookup goes first:
   * when the homeserver does not answer it, nothing is submitted or published and a first attempt
   * leaves the invite unsubmitted, so the person can retry or choose another signer.
   */
  async registerAccount(
    onProgress?: (progress: LocalAccountRegistrationProgress) => void,
  ): Promise<LocalAccountSetupResult<LocalIdentityMetadata>> {
    const identity = this.identity;
    const invite = this.invite;
    if (!identity || !invite) return Result.err({ code: "create_failed" });
    if (!this.backupVerified && !this.verificationSkipped)
      return Result.err({ code: "backup_not_verified" });
    onProgress?.("signing_up");
    const lookup = await this.invites.lookUp(invite, this.requests.signal);
    if (this.identity !== identity) return Result.err({ code: "create_failed" });
    if (!lookup.reached) return Result.err({ code: "homeserver_unreachable" });
    const started = this.drafts.markRegistrationStarted(identity.publicIdentity.publicKeyZ32);
    if (Result.isError(started))
      return Result.err({ code: "draft_storage_failed", cause: started.error });
    this.registrationStarted = true;

    const signup = await this.pubky.signup(
      identity.keyHandle,
      invite.homeserverPubky,
      invite.signupToken,
    );
    if (
      Result.isError(signup) &&
      signup.error.code !== "account_exists" &&
      signup.error.code !== "signup_uncertain"
    ) {
      // The homeserver definitively refused this invite; retrying with it cannot succeed.
      return Result.err({
        code: signup.error.code === "signup_failed" ? "invite_rejected" : "registration_failed",
        cause: signup.error,
      });
    }

    onProgress?.("publishing");
    const published = await this.pubky.publishHomeserver(
      identity.keyHandle,
      invite.homeserverPubky,
    );
    // A failed publication is not fatal: the blocking sign-in below publishes the record again
    // and waits for it. Only a bad key or homeserver stops registration here.
    if (Result.isError(published) && published.error.code !== "publish_failed") {
      return Result.err({ code: "registration_failed", cause: published.error });
    }

    onProgress?.("activating");
    const signedIn = await this.pubky.signin(identity.keyHandle, "after-publication");
    if (
      Result.isError(signedIn) ||
      signedIn.value.publicIdentity.publicKeyZ32 !== identity.publicIdentity.publicKeyZ32
    ) {
      return Result.err({
        code: "signin_failed",
        ...(Result.isError(signedIn) ? { cause: signedIn.error } : {}),
      });
    }
    const saved = this.saveRegisteredIdentity(identity, invite.homeserverPubky);
    if (Result.isError(saved)) return saved;
    // The catalog now owns the key. A lingering draft is removed when account creation opens
    // again or prepares the next setup, instead of failing a registration that completed.
    const removed = this.drafts.remove(identity.publicIdentity.publicKeyZ32);
    if (Result.isError(removed)) {
      LOGGER.warn("identity.local_account.cleanup.failed", {
        operation: "remove_draft",
        code: removed.error.code,
      });
    }
    return saved;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.requests.abort();
    this.forgetIdentity();
    try {
      this.pubky.dispose();
    } catch (error) {
      LOGGER.warn("identity.local_account.cleanup.failed", {
        operation: "pubky_dispose",
        ...safeErrorLogFields(error),
      });
    }
  }

  private forgetIdentity(): void {
    if (this.identity) this.pubky.disposeIdentityKey(this.identity.keyHandle);
    this.identity = undefined;
    this.invite = undefined;
    this.step = "password";
    this.registrationStarted = false;
    this.backupCreated = false;
    this.backupVerified = false;
    this.verificationSkipped = false;
  }

  private resumeDraft(
    { draft, secretKey }: { draft: LocalAccountDraft; secretKey: PubkySecretKeyMaterial },
    invite: HomeserverSignupDetails,
  ): LocalAccountSetupResult<LocalIdentityMetadata> {
    try {
      if (
        draft.invite.homeserverPubky !== invite.homeserverPubky ||
        draft.invite.signupToken !== invite.signupToken
      )
        return Result.err({ code: "create_failed" });
      const restored = this.pubky.restoreIdentityKey(secretKey);
      if (Result.isError(restored))
        return Result.err({ code: "create_failed", cause: restored.error });
      if (restored.value.publicIdentity.publicKeyZ32 !== draft.publicIdentity.publicKeyZ32) {
        this.pubky.disposeIdentityKey(restored.value.keyHandle);
        return Result.err({ code: "create_failed" });
      }
      this.identity = restored.value;
      this.invite = draft.invite;
      this.step = draft.step;
      this.registrationStarted = draft.registrationStarted === true;
      return Result.ok({ publicIdentity: restored.value.publicIdentity });
    } finally {
      secretKey.bytes.fill(0);
    }
  }

  private createDraft(
    invite: HomeserverSignupDetails,
  ): LocalAccountSetupResult<LocalIdentityMetadata> {
    const created = this.pubky.createIdentityKey();
    if (Result.isError(created)) {
      return Result.err({ code: "create_failed", cause: created.error });
    }
    const secret = this.pubky.exportSecretKey(created.value.keyHandle);
    if (Result.isError(secret)) {
      this.pubky.disposeIdentityKey(created.value.keyHandle);
      return Result.err({ code: "create_failed", cause: secret.error });
    }
    try {
      const persisted = this.drafts.create(
        { publicIdentity: created.value.publicIdentity, invite, step: "password" },
        secret.value,
      );
      if (Result.isError(persisted)) {
        this.pubky.disposeIdentityKey(created.value.keyHandle);
        return Result.err({ code: "storage_failed", cause: persisted.error });
      }
      this.identity = created.value;
      this.invite = invite;
      this.step = "password";
      this.registrationStarted = false;
      return Result.ok({ publicIdentity: created.value.publicIdentity });
    } finally {
      secret.value.bytes.fill(0);
    }
  }

  /** `homeserverPubky` is the host this run signed the key up on. */
  private saveRegisteredIdentity(
    identity: PubkyIdentityKey,
    homeserverPubky: string,
  ): LocalAccountSetupResult<LocalIdentityMetadata> {
    const secret = this.pubky.exportSecretKey(identity.keyHandle);
    if (Result.isError(secret)) return Result.err({ code: "storage_failed", cause: secret.error });
    try {
      const catalog = this.repository.list();
      if (Result.isError(catalog)) {
        return Result.err({ code: "storage_failed", cause: catalog.error });
      }
      const existing = catalog.value.identities.find(
        (candidate) =>
          candidate.publicIdentity.publicKeyZ32 === identity.publicIdentity.publicKeyZ32,
      );
      // A Ring entry holds no secret here; overwriting it would silently change where the
      // key lives. A retried registration re-saves its own entry.
      if (existing?.keySource === "ring") return Result.err({ code: "external_key" });
      const saved = this.repository.save(
        {
          ...(existing ?? { publicIdentity: identity.publicIdentity, profileSetupRequired: true }),
          homeserverPubky,
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
