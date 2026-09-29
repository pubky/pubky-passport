import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { NETWORK_OPERATION_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from "@/libs/passportPolicy";
import type { GoogleIdentityCredentials } from "./gia/GoogleImplicitAuthorization";
import type { GoogleIdentityLifecycleError } from "./googleIdentityErrors";
import { HomegateClient } from "@/client/logic/homegate/HomegateClient";
import type { HomeserverSignupDetails } from "@/client/logic/signup/homeserverInvite";
import { GoogleDrivePassportFileStore } from "@/client/logic/passport-file/google/GoogleDrivePassportFileStore";
import { GoogleDriveVisibleRecoveryCopies } from "@/client/logic/passport-file/google/GoogleDriveVisibleRecoveryCopies";
import {
  normalizePassportFileOrigin,
  type PassportFileEnvelope,
} from "@/client/logic/passport-file/passportFileEnvelope";
import { PassportFileWebCrypto } from "@/client/logic/passport-file/PassportFileWebCrypto";
import {
  PUBKY_SECRET_KEY_FORMAT,
  type PubkyIdentityKey,
  type PubkyPublicIdentity,
  type PubkySecretKeyMaterial,
} from "@/client/logic/pubky/pubkyIdentityKey";
import { startHomeserverRepublish } from "@/client/logic/pubky/startHomeserverRepublish";
import { PubkySdkAdapter } from "@/client/logic/pubky/PubkySdkAdapter";
import { SignupTokenChecker } from "@/client/logic/pubky/SignupTokenChecker";
import { GoogleWrappingKeyApiClient } from "@/client/logic/wrapping-key/GoogleWrappingKeyApiClient";
import { LocalStorageIdentityRepository } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";

/** Safe setup or restore progress emitted while establishing an identity. */
export type GoogleIdentityProgress =
  | { flow: "lookup"; step: "checking" }
  | {
      flow: "create";
      step:
        | "preparing"
        | "creating"
        | "storing_passport_file"
        | "signing_up"
        | "publishing"
        | "activating";
    }
  | { flow: "restore"; step: "restoring" | "signing_in" }
  | { flow: "repair"; step: "signing_up" | "publishing" | "signing_in" };

/** Outcome of the optional visible recovery copy written next to the private Drive backup. */
export type VisibleRecoveryCopyStatus = "created" | "unconfirmed" | "skipped";

type GoogleIdentityEstablishmentValue =
  | {
      establishmentMode: "created";
      publicIdentity: PubkyPublicIdentity;
      visibleRecoveryCopyStatus: VisibleRecoveryCopyStatus;
    }
  | {
      establishmentMode: "restored";
      publicIdentity: PubkyPublicIdentity;
    };

type GoogleIdentityEstablishmentResult = ResultType<
  GoogleIdentityEstablishmentValue,
  GoogleIdentityLifecycleError
>;

type DetachGoogleIdentityResult = ResultType<void, GoogleIdentityLifecycleError>;

export type GoogleIdentityBackup = {
  /** The Google account the identity is now attached to, named on the completion screen. */
  googleAccount: GoogleAccountProfile;
  visibleRecoveryCopyStatus: VisibleRecoveryCopyStatus;
};

type EstablishmentStepResult<Success = void> = ResultType<Success, GoogleIdentityLifecycleError>;

type LocalIdentityRecord = {
  identity: LocalIdentityMetadata;
  secretKey: PubkySecretKeyMaterial;
};

/**
 * Backups written to Drive whose local Google association could not be saved, keyed by Google
 * subject and public key, with the visible-copy outcome to report once linking succeeds.
 */
export type UnlinkedGoogleBackups = Map<string, VisibleRecoveryCopyStatus>;

/**
 * Page-scoped, so leaving and reopening the attach screen can still finish the link. Held only
 * in memory: the storage that failed to record the link cannot be trusted to record this either.
 */
const UNLINKED_GOOGLE_BACKUPS: UnlinkedGoogleBackups = new Map();

/**
 * Homegate invites issued to a Google account that no signup has used yet, keyed by Google
 * subject. Each invite spends one of the account's few Google verifications, so an attempt that
 * stops before signing up, for example while the homeserver does not answer, leaves its invite
 * for the next attempt instead of requesting another.
 */
export type UnspentGoogleSignupInvites = Map<string, HomeserverSignupDetails>;

/** Page-scoped and held only in memory, like {@link UNLINKED_GOOGLE_BACKUPS}. */
const UNSPENT_GOOGLE_SIGNUP_INVITES: UnspentGoogleSignupInvites = new Map();

/**
 * How {@link GoogleIdentityLifecycle.signupAndActivate} treats a definitive signup: a new
 * identity republishes PKDNS in the background and signs in at once, a reconciliation keeps the
 * awaited publish and blocking sign-in.
 */
type ActivationMode =
  | { reconciliation: true }
  | { reconciliation: false; onBackgroundRepublish: (republish: Promise<void>) => void };

export type DriveStorePort = Pick<
  GoogleDrivePassportFileStore,
  | "hasPassportFile"
  | "readPassportFile"
  | "deleteInvalidPassportFile"
  | "createPassportFile"
  | "deletePassportFile"
>;

export type VisibleRecoveryCopiesPort = Pick<
  GoogleDriveVisibleRecoveryCopies,
  "createVisibleRecoveryCopy" | "deleteVisibleRecoveryCopies"
>;

/** Collaborators the lifecycle otherwise constructs itself; every member is optional. */
export type GoogleIdentityLifecycleDependencies = {
  fetch?: typeof fetch;
  pubky?: Pick<
    PubkySdkAdapter,
    | "createIdentityKey"
    | "exportSecretKey"
    | "restoreIdentityKey"
    | "signup"
    | "signin"
    | "resolveHomeserver"
    | "publishHomeserver"
    | "disposeIdentityKey"
    | "dispose"
  >;
  crypto?: Pick<PassportFileWebCrypto, "encryptSecretKeyBytes" | "decryptSecretKeyBytes">;
  repository?: Pick<LocalStorageIdentityRepository, "save" | "read" | "setGoogleAccount">;
  wrappingKeys?: Pick<GoogleWrappingKeyApiClient, "requestGoogleWrappingKey">;
  homegate?: Pick<HomegateClient, "requestGoogleSignupToken">;
  signupTokens?: Pick<SignupTokenChecker, "lookUp">;
  createDriveStore?: (driveAccessToken: string, fetchImpl: typeof fetch) => DriveStorePort;
  createVisibleRecoveryCopies?: (
    driveAccessToken: string,
    fetchImpl: typeof fetch,
  ) => VisibleRecoveryCopiesPort;
  /** Replaces the page-scoped record of backups created but not linked locally. */
  unlinkedBackups?: UnlinkedGoogleBackups;
  /** Replaces the page-scoped record of Homegate invites no signup has used yet. */
  unspentSignupInvites?: UnspentGoogleSignupInvites;
};

/**
 * Executes Google-backed identity establishment, repair, attachment (backup of an existing local
 * identity), and detachment.
 *
 * Unlike `GoogleIdentityController`, this class does not request authorization or own
 * presentation state. It receives fresh credentials from the controller and coordinates Google
 * Drive persistence, wrapping-key retrieval, Homegate signup, cryptography, local storage, and
 * Pubky activation.
 *
 * Public asynchronous operations settle with a Result for operational and unexpected failures;
 * they do not intentionally reject. Construction can throw when a required browser dependency or
 * configured endpoint cannot be initialized.
 *
 * Optional `dependencies` replace the collaborators this class otherwise
 * constructs. Production omits them.
 *
 * An injected `pubky` is not disposed if later construction throws. After a
 * successful constructor, {@link dispose} always disposes `this.pubky`.
 */
export class GoogleIdentityLifecycle {
  private readonly repository: NonNullable<GoogleIdentityLifecycleDependencies["repository"]>;
  private readonly pubky: NonNullable<GoogleIdentityLifecycleDependencies["pubky"]>;
  private readonly wrappingKeys: NonNullable<GoogleIdentityLifecycleDependencies["wrappingKeys"]>;
  private readonly homegate: NonNullable<GoogleIdentityLifecycleDependencies["homegate"]>;
  private readonly signupTokens: NonNullable<GoogleIdentityLifecycleDependencies["signupTokens"]>;
  private readonly crypto: NonNullable<GoogleIdentityLifecycleDependencies["crypto"]>;
  private readonly createDriveStore: NonNullable<
    GoogleIdentityLifecycleDependencies["createDriveStore"]
  >;
  private readonly createVisibleRecoveryCopies: NonNullable<
    GoogleIdentityLifecycleDependencies["createVisibleRecoveryCopies"]
  >;
  private readonly requests = new AbortController();
  private readonly unlinkedBackups: UnlinkedGoogleBackups;
  private readonly unspentSignupInvites: UnspentGoogleSignupInvites;
  private homeserverRepublish: Promise<void> | undefined;
  private readonly fetch: typeof fetch;
  private disposed = false;

  /** @throws {Error} when a required dependency or configured endpoint cannot be initialized. */
  constructor(
    homegateBaseUrl: string,
    private readonly passportOrigin: string,
    dependencies: GoogleIdentityLifecycleDependencies = {},
  ) {
    const ownsPubky = dependencies.pubky === undefined;
    const fetchImpl: typeof fetch =
      dependencies.fetch ?? ((request, init) => globalThis.fetch(request, init));
    this.fetch = (request, init) => {
      const signals = [this.requests.signal];
      // A client that passes a signal owns that request's timeout: pass a timeout or deadline
      // signal, never a bare cancellation signal. Otherwise this wrapper adds the network timeout.
      if (init?.signal) signals.push(init.signal);
      else signals.push(AbortSignal.timeout(NETWORK_OPERATION_TIMEOUT_MS));
      return fetchImpl(request, { ...init, signal: AbortSignal.any(signals) });
    };
    this.pubky = dependencies.pubky ?? new PubkySdkAdapter();
    this.repository = dependencies.repository ?? new LocalStorageIdentityRepository();
    this.unlinkedBackups = dependencies.unlinkedBackups ?? UNLINKED_GOOGLE_BACKUPS;
    this.unspentSignupInvites = dependencies.unspentSignupInvites ?? UNSPENT_GOOGLE_SIGNUP_INVITES;
    this.signupTokens = dependencies.signupTokens ?? new SignupTokenChecker();
    this.createDriveStore =
      dependencies.createDriveStore ??
      ((driveAccessToken, nextFetch) =>
        new GoogleDrivePassportFileStore(driveAccessToken, nextFetch));
    this.createVisibleRecoveryCopies =
      dependencies.createVisibleRecoveryCopies ??
      ((driveAccessToken, nextFetch) =>
        new GoogleDriveVisibleRecoveryCopies(driveAccessToken, nextFetch));
    try {
      this.wrappingKeys = dependencies.wrappingKeys ?? new GoogleWrappingKeyApiClient(this.fetch);
      this.homegate = dependencies.homegate ?? new HomegateClient(homegateBaseUrl, this.fetch);
      this.crypto = dependencies.crypto ?? new PassportFileWebCrypto();
    } catch (e) {
      if (ownsPubky) {
        try {
          this.pubky.dispose();
        } catch (e) {
          LOGGER.warn("identity.google.cleanup.failed", {
            operation: "construction_pubky_dispose",
            ...safeErrorLogFields(e),
          });
        }
      }
      throw e;
    }
  }

  /**
   * Restores the Drive identity when present, otherwise creates and activates one.
   * Creation without visible-copy permission pauses until explicitly allowed by the caller.
   * The promise settles with a Result and does not intentionally reject.
   */
  async establishIdentity(
    credentials: GoogleIdentityCredentials,
    report: (progress: GoogleIdentityProgress) => void,
    allowWithoutVisibleBackup = false,
  ): Promise<GoogleIdentityEstablishmentResult> {
    return this.restoreOrCreate(credentials, report, allowWithoutVisibleBackup, false);
  }

  /**
   * Deletes the Drive file only when this attempt confirms it still cannot be decrypted for
   * this Google account, then creates a replacement identity. A file that decrypts after all is
   * restored and kept. Resolves the visible-backup decision before deleting anything.
   * The promise settles with a Result and does not intentionally reject.
   */
  async replaceUndecryptablePassportFile(
    credentials: GoogleIdentityCredentials,
    report: (progress: GoogleIdentityProgress) => void,
    allowWithoutVisibleBackup = false,
  ): Promise<GoogleIdentityEstablishmentResult> {
    if (!credentials.visibleBackupPermissionGranted && !allowWithoutVisibleBackup) {
      return Result.err({ code: "visible_backup_permission_missing" });
    }
    return this.restoreOrCreate(credentials, report, allowWithoutVisibleBackup, true);
  }

  /**
   * Deletes a confirmed malformed Drive file, then creates or restores current state.
   * Resolves the visible-backup decision before deleting the malformed file.
   * The promise settles with a Result and does not intentionally reject.
   */
  async replaceInvalidPassportFile(
    credentials: GoogleIdentityCredentials,
    report: (progress: GoogleIdentityProgress) => void,
    allowWithoutVisibleBackup = false,
  ): Promise<GoogleIdentityEstablishmentResult> {
    if (!credentials.visibleBackupPermissionGranted && !allowWithoutVisibleBackup) {
      return Result.err({ code: "visible_backup_permission_missing" });
    }
    try {
      const store = this.createDriveStore(credentials.driveAccessToken, this.fetch);
      const deleted = await store.deleteInvalidPassportFile(this.ownOrigin());
      if (Result.isError(deleted)) {
        if (deleted.error.code === "foreign_file" && deleted.error.passportFileOrigin) {
          return Result.err({
            code: "foreign_passport_file",
            passportFileOrigin: deleted.error.passportFileOrigin,
            cause: deleted.error,
          });
        }
        return Result.err({
          code: "invalid_passport_file_delete_failed",
          cause: deleted.error,
        });
      }
      return await this.establishIdentity(credentials, report, allowWithoutVisibleBackup);
    } catch (e) {
      LOGGER.warn("identity.google.invalid_passport_file_replacement.failed", {
        code: "unexpected_failure",
        ...safeErrorLogFields(e),
      });
      return Result.err({
        code: "invalid_passport_file_delete_failed",
        cause: e,
      });
    }
  }

  /**
   * Deletes Google Drive Passport files, then clears the Google association.
   * The local identity and active selection are preserved, including on failure.
   * Nothing is deleted unless this browser still holds the key for the identity and its
   * record is bound to the expected Google account; otherwise the Drive copy could be the
   * only remaining copy of the key.
   * The promise settles with a Result and does not intentionally reject.
   */
  async detachIdentity(
    credentials: GoogleIdentityCredentials,
    publicIdentity: PubkyPublicIdentity,
    expectedGoogleSubject: string,
  ): Promise<DetachGoogleIdentityResult> {
    if (credentials.googleAccount.googleSubject !== expectedGoogleSubject) {
      LOGGER.warn("identity.google.detach.failed", {
        stage: "account_binding",
        code: "google_account_mismatch",
      });
      return Result.err({ code: "google_account_mismatch" });
    }

    if (!credentials.visibleBackupPermissionGranted) {
      return Result.err({ code: "google_detachment_permission_required" });
    }

    try {
      const local = this.verifyLocalIdentityBinding(publicIdentity, expectedGoogleSubject);
      if (Result.isError(local)) return Result.err(local.error);

      const deleted = await this.deleteVerifiedGoogleDriveFiles(credentials, publicIdentity);
      if (Result.isError(deleted)) return Result.err(deleted.error);
      // The deleted backup can no longer be claimed by a later attach on this page.
      this.unlinkedBackups.delete(unlinkedBackupKey(credentials.googleAccount, publicIdentity));

      const unlinked = this.repository.setGoogleAccount(publicIdentity.publicKeyZ32, undefined);
      return Result.isError(unlinked)
        ? Result.err({ code: "local_unlink_failed", cause: unlinked.error })
        : Result.ok();
    } catch (e) {
      LOGGER.warn("identity.google.detach.failed", {
        ...safeErrorLogFields(e),
        code: "unexpected_failure",
      });
      return Result.err({ code: "unexpected_failure", cause: e });
    }
  }

  /**
   * Attaches a local identity to an empty Google account; existing backups are never opened.
   * The account is checked before the visible-copy decision, and the secret key is read only
   * for encryption. A backup this page created but could not record locally is linked on a
   * later attempt for the same identity and Google account instead of being reported as a
   * conflict.
   * The promise settles with a Result and does not intentionally reject.
   */
  async backupIdentity(
    credentials: GoogleIdentityCredentials,
    publicIdentity: PubkyPublicIdentity,
    allowWithoutVisibleBackup = false,
  ): Promise<EstablishmentStepResult<GoogleIdentityBackup>> {
    try {
      LOGGER.info("identity.google.backup.started");
      const local = this.readLocalIdentityMetadata(publicIdentity);
      if (Result.isError(local)) return Result.err(local.error);
      const boundSubject = local.value.googleAccount?.googleSubject;
      if (boundSubject !== undefined && boundSubject !== credentials.googleAccount.googleSubject) {
        LOGGER.warn("identity.google.backup.failed", {
          stage: "account_binding",
          code: "google_account_mismatch",
        });
        return Result.err({ code: "google_account_mismatch" });
      }

      const store = this.createDriveStore(credentials.driveAccessToken, this.fetch);
      const stored = await store.hasPassportFile();
      if (Result.isError(stored)) {
        return Result.err({ code: "drive_read_failed", cause: stored.error });
      }
      if (stored.value) {
        // Only a file this page created for exactly this identity and Google account may be
        // linked without opening it. Any other existing backup stays unread and unclaimed.
        const unlinked = this.unlinkedBackups.get(
          unlinkedBackupKey(credentials.googleAccount, publicIdentity),
        );
        if (unlinked === undefined) return Result.err({ code: "google_backup_conflict" });
        LOGGER.info("identity.google.backup.link_only");
        return this.linkGoogleAccount(publicIdentity, credentials.googleAccount, unlinked);
      }

      if (!credentials.visibleBackupPermissionGranted && !allowWithoutVisibleBackup) {
        return Result.err({ code: "visible_backup_permission_missing" });
      }
      const wrappingKey = await this.requestWrappingKey(credentials.googleIdToken);
      if (Result.isError(wrappingKey)) return Result.err(wrappingKey.error);
      const encrypted = await this.encryptLocalSecretKey(publicIdentity, wrappingKey.value);
      if (Result.isError(encrypted)) return Result.err(encrypted.error);
      const written = await this.writePassportFile(store, encrypted.value);
      if (Result.isError(written)) return Result.err(written.error);

      const visibleCopy = this.startVisibleRecoveryCopy(
        credentials.visibleBackupPermissionGranted
          ? this.createVisibleRecoveryCopies(credentials.driveAccessToken, this.fetch)
          : undefined,
        encrypted.value,
        publicIdentity,
      );
      const visibleRecoveryCopyStatus = await this.settleVisibleRecoveryCopy(visibleCopy);
      const linked = this.linkGoogleAccount(
        publicIdentity,
        credentials.googleAccount,
        visibleRecoveryCopyStatus,
      );
      if (Result.isOk(linked)) {
        LOGGER.info("identity.google.backup.completed", { visibleRecoveryCopyStatus });
      }
      return linked;
    } catch (e) {
      LOGGER.warn("identity.google.backup.failed", {
        code: "unexpected_failure",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "unexpected_failure", cause: e });
    }
  }

  /** Aborts browser requests without freeing key handles that may still be in use. */
  abortRequests(): void {
    this.requests.abort();
  }

  /** Releases all SDK key material owned by this screen-scoped operation object. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortRequests();
    const release = () => this.pubky.dispose();
    if (this.homeserverRepublish) void this.homeserverRepublish.finally(release);
    else release();
  }

  /**
   * Restores the found Drive file, otherwise creates a new identity. With
   * `replaceUndecryptableFile`, a file whose decryption fails on this very read is deleted by
   * revision before creation continues, so a file changed meanwhile by another device is never
   * removed.
   */
  private async restoreOrCreate(
    credentials: GoogleIdentityCredentials,
    report: (progress: GoogleIdentityProgress) => void,
    allowWithoutVisibleBackup: boolean,
    replaceUndecryptableFile: boolean,
  ): Promise<GoogleIdentityEstablishmentResult> {
    try {
      report({ flow: "lookup", step: "checking" });
      const store = this.createDriveStore(credentials.driveAccessToken, this.fetch);
      LOGGER.info("identity.google.drive_read.started");
      const storedFile = await store.readPassportFile();
      if (Result.isError(storedFile)) {
        // A malformed file naming another Passport origin is that origin's, never offered for deletion.
        const claimed = storedFile.error.passportFileOrigin;
        if (claimed && claimed !== this.ownOrigin()) {
          LOGGER.warn("identity.google.foreign_passport_file", { passportFileOrigin: claimed });
          return Result.err({
            code: "foreign_passport_file",
            passportFileOrigin: claimed,
            cause: storedFile.error,
          });
        }
        return Result.err({
          code:
            storedFile.error.code === "invalid_file"
              ? "invalid_passport_file"
              : "drive_read_failed",
          cause: storedFile.error,
        });
      }

      if (storedFile.value.status === "found") {
        LOGGER.info("identity.google.drive_read.completed", { status: "found" });
        const wrappingKey = await this.requestWrappingKey(
          credentials.googleIdToken,
          storedFile.value.envelope,
        );
        if (Result.isError(wrappingKey)) {
          // Another Passport's key ID means nothing to this server's keyring.
          const foreignKeyUnavailable =
            wrappingKey.error.code === "wrapping_key_failed" &&
            wrappingKey.error.detailCode === "key_unavailable" &&
            !this.isOwnPassportFile(storedFile.value.envelope);
          return Result.err(
            foreignKeyUnavailable
              ? this.foreignPassportFileError(storedFile.value.envelope, wrappingKey.error)
              : wrappingKey.error,
          );
        }
        const restored = await this.restoreIdentity(
          credentials,
          storedFile.value.envelope,
          wrappingKey.value.wrappingKey,
          report,
        );
        // Only this origin's own file that its key no longer opens; a foreign file is never deleted.
        const undecryptable =
          Result.isError(restored) && restored.error.code === "passport_file_undecryptable";
        if (!replaceUndecryptableFile || !undecryptable) return restored;

        LOGGER.info("identity.google.undecryptable_passport_file_delete.started");
        const deleted = await store.deletePassportFile(storedFile.value.reference);
        if (Result.isError(deleted)) {
          return Result.err({
            code: "undecryptable_passport_file_delete_failed",
            cause: deleted.error,
          });
        }
        LOGGER.info("identity.google.undecryptable_passport_file_delete.completed");
      } else {
        LOGGER.info("identity.google.drive_read.completed", { status: "missing" });
      }

      if (!credentials.visibleBackupPermissionGranted && !allowWithoutVisibleBackup) {
        return Result.err({ code: "visible_backup_permission_missing" });
      }
      report({ flow: "create", step: "preparing" });
      const wrappingKey = await this.requestWrappingKey(credentials.googleIdToken);
      if (Result.isError(wrappingKey)) return Result.err(wrappingKey.error);
      const signupDetails = await this.requestSignupToken(credentials);
      if (Result.isError(signupDetails)) return Result.err(signupDetails.error);
      // Nothing is written to Drive for a signup that cannot succeed: a backup left behind would
      // send every later attempt down the restore path instead of creating an account.
      const checked = await this.checkSignupHomeserver(
        credentials.googleAccount,
        signupDetails.value,
        "create",
      );
      if (Result.isError(checked)) return Result.err(checked.error);

      report({ flow: "create", step: "creating" });
      const visibleCopies = credentials.visibleBackupPermissionGranted
        ? this.createVisibleRecoveryCopies(credentials.driveAccessToken, this.fetch)
        : undefined;
      return await this.createIdentity(
        credentials.googleAccount,
        signupDetails.value,
        wrappingKey.value.wrappingKey,
        wrappingKey.value.keyId,
        report,
        store,
        visibleCopies,
      );
    } catch (e) {
      LOGGER.warn("identity.google.restore_or_create.failed", {
        code: "unexpected_failure",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "unexpected_failure", cause: e });
    }
  }

  /**
   * Creates the encrypted Drive file before attempting homeserver activation. Once
   * that authoritative file exists it is preserved on every later failure. The visible
   * recovery copy uploads while the homeserver work runs; it is never on the activation path.
   */
  private async createIdentity(
    googleAccount: GoogleAccountProfile,
    signupDetails: HomeserverSignupDetails,
    wrappingKey: string,
    keyId: string,
    report: (progress: GoogleIdentityProgress) => void,
    store: DriveStorePort,
    visibleCopies: VisibleRecoveryCopiesPort | undefined,
  ): Promise<GoogleIdentityEstablishmentResult> {
    LOGGER.info("identity.google.create.started");
    LOGGER.info("identity.google.create_key.started");
    const created = await this.pubky.createIdentityKey();
    if (Result.isError(created)) {
      return Result.err({ code: "create_failed", cause: created.error });
    }
    LOGGER.info("identity.google.create_key.completed");

    const background: { republish: Promise<void> | undefined } = { republish: undefined };
    try {
      const secretKey = await this.pubky.exportSecretKey(created.value.keyHandle);
      if (Result.isError(secretKey)) {
        return Result.err({ code: "create_failed", cause: secretKey.error });
      }

      report({ flow: "create", step: "storing_passport_file" });
      LOGGER.info("identity.google.encrypt.started");
      const encrypted = await this.crypto
        .encryptSecretKeyBytes(secretKey.value.bytes, wrappingKey, this.passportOrigin, keyId)
        .finally(() => {
          secretKey.value.bytes.fill(0);
        });
      if (Result.isError(encrypted)) {
        return Result.err({ code: "encrypt_failed", cause: encrypted.error });
      }
      const envelope = encrypted.value;
      LOGGER.info("identity.google.encrypt.completed");

      const written = await this.writePassportFile(store, envelope);
      if (Result.isError(written)) return Result.err(written.error);

      const visibleCopy = this.startVisibleRecoveryCopy(
        visibleCopies,
        envelope,
        created.value.publicIdentity,
      );

      const activated = await this.signupAndActivate(
        created.value,
        signupDetails,
        googleAccount,
        report,
        {
          reconciliation: false,
          onBackgroundRepublish: (republish) => {
            background.republish = republish;
          },
        },
      );
      if (Result.isError(activated)) return Result.err(activated.error);

      const visibleRecoveryCopyStatus = await this.settleVisibleRecoveryCopy(visibleCopy);
      LOGGER.info("identity.google.create.completed", { visibleRecoveryCopyStatus });
      return Result.ok({
        establishmentMode: "created",
        publicIdentity: created.value.publicIdentity,
        visibleRecoveryCopyStatus,
      });
    } finally {
      // A background republish still signs with this key; free it once that settles.
      if (background.republish) {
        void background.republish.finally(() =>
          this.disposeIdentityKey(created.value, "created_key_dispose"),
        );
      } else {
        this.disposeIdentityKey(created.value, "created_key_dispose");
      }
    }
  }

  /** Creates the operational Drive file; a concurrent writer observed by the store is a conflict. */
  private async writePassportFile(
    store: DriveStorePort,
    envelope: PassportFileEnvelope,
  ): Promise<EstablishmentStepResult> {
    LOGGER.info("identity.google.operational_drive_write.started");
    const written = await store.createPassportFile(envelope);
    if (Result.isError(written)) {
      return Result.err({
        code:
          written.error.code === "create_conflict" ? "drive_create_conflict" : "drive_write_failed",
        cause: written.error,
      });
    }
    LOGGER.info("identity.google.operational_drive_write.completed");
    return Result.ok();
  }

  /** Starts the optional visible copy; it never fails the caller, which settles it later. */
  private startVisibleRecoveryCopy(
    visibleCopies: VisibleRecoveryCopiesPort | undefined,
    envelope: PassportFileEnvelope,
    publicIdentity: PubkyPublicIdentity,
  ): Promise<boolean> | undefined {
    if (!visibleCopies) return undefined;
    LOGGER.info("identity.google.visible_recovery_copy.started");
    return this.createVisibleRecoveryCopy(visibleCopies, envelope, publicIdentity);
  }

  private async settleVisibleRecoveryCopy(
    visibleCopy: Promise<boolean> | undefined,
  ): Promise<VisibleRecoveryCopyStatus> {
    let status: VisibleRecoveryCopyStatus = "skipped";
    if (visibleCopy) {
      status = (await visibleCopy) ? "created" : "unconfirmed";
      if (status === "unconfirmed") {
        LOGGER.warn("identity.google.visible_recovery_copy.unconfirmed", {
          activationCompleted: true,
        });
      }
    }
    LOGGER.info("identity.google.visible_recovery_copy.completed", { status });
    return status;
  }

  /**
   * Restores one identity and signs in normally before attempting PKDNS and
   * homeserver repair for an interrupted setup.
   */
  private async restoreIdentity(
    credentials: GoogleIdentityCredentials,
    envelope: PassportFileEnvelope,
    wrappingKey: string,
    report: (progress: GoogleIdentityProgress) => void,
  ): Promise<GoogleIdentityEstablishmentResult> {
    report({ flow: "restore", step: "restoring" });
    const restored = await this.restoreKey(envelope, wrappingKey);
    if (Result.isError(restored)) return Result.err(restored.error);

    let republish: Promise<void> | undefined;
    try {
      report({ flow: "restore", step: "signing_in" });
      const signedIn = await this.pubky.signin(restored.value.keyHandle, "normal");
      if (!Result.isError(signedIn)) {
        const verified = this.verifySessionIdentity(restored.value, signedIn.value.publicIdentity);
        if (Result.isError(verified)) return Result.err(verified.error);
        const saved = await this.saveIdentity(
          restored.value,
          credentials.googleAccount,
          "restored",
        );
        if (Result.isError(saved)) return Result.err(saved.error);
        this.homeserverRepublish = startHomeserverRepublish(() =>
          this.pubky.publishHomeserver(restored.value.keyHandle),
        );
        republish = this.homeserverRepublish;
        return Result.ok({
          establishmentMode: "restored",
          publicIdentity: restored.value.publicIdentity,
        });
      }

      const homeserver = await this.pubky.resolveHomeserver(
        restored.value.publicIdentity.publicKeyZ32,
      );
      if (Result.isError(homeserver)) {
        return Result.err({ code: "signin_failed", cause: homeserver.error });
      }
      if (homeserver.value !== null) {
        return Result.err({ code: "signin_failed", cause: signedIn.error });
      }

      report({ flow: "repair", step: "signing_up" });
      const signupDetails = await this.requestSignupToken(credentials);
      if (Result.isError(signupDetails)) return Result.err(signupDetails.error);
      // A record published for an unreachable homeserver would end every later repair attempt.
      const checked = await this.checkSignupHomeserver(
        credentials.googleAccount,
        signupDetails.value,
        "repair",
      );
      if (Result.isError(checked)) return Result.err(checked.error);
      const activated = await this.signupAndActivate(
        restored.value,
        signupDetails.value,
        credentials.googleAccount,
        report,
        { reconciliation: true },
      );
      if (Result.isError(activated)) return Result.err(activated.error);
      return Result.ok({
        establishmentMode: "restored",
        publicIdentity: restored.value.publicIdentity,
      });
    } finally {
      if (republish) {
        void republish.finally(() =>
          this.disposeIdentityKey(restored.value, "restored_key_dispose"),
        );
      } else {
        this.disposeIdentityKey(restored.value, "restored_key_dispose");
      }
    }
  }

  /** Decrypts exactly 32 secret bytes; the Pubky adapter consumes and clears them during restoration. */
  private async restoreKey(
    envelope: PassportFileEnvelope,
    wrappingKey: string,
  ): Promise<EstablishmentStepResult<PubkyIdentityKey>> {
    LOGGER.info("identity.google.decrypt.started");
    const secretKey = await this.crypto.decryptSecretKeyBytes(envelope, wrappingKey);
    if (Result.isError(secretKey)) {
      if (!isKeyMismatch(secretKey.error.code)) {
        return Result.err({ code: "decrypt_failed", cause: secretKey.error });
      }
      return Result.err(
        this.isOwnPassportFile(envelope)
          ? { code: "passport_file_undecryptable", cause: secretKey.error }
          : this.foreignPassportFileError(envelope, secretKey.error),
      );
    }

    const restored = await this.pubky.restoreIdentityKey({
      bytes: secretKey.value,
      format: PUBKY_SECRET_KEY_FORMAT,
    });
    if (Result.isError(restored)) {
      return Result.err({ code: "restore_failed", cause: restored.error });
    }
    LOGGER.info("identity.google.restore.completed");
    return Result.ok(restored.value);
  }

  /**
   * Shared activation for new and interrupted identities. The SDK's signup publishes PKDNS
   * itself, so a definitive new signup only republishes in the background and signs in without
   * waiting. Signup conflict means the account already exists. Ambiguous signup or publication
   * failures are verified through blocking sign-in before they are treated as fatal.
   */
  private async signupAndActivate(
    identity: PubkyIdentityKey,
    signupDetails: HomeserverSignupDetails,
    googleAccount: GoogleAccountProfile,
    report: (progress: GoogleIdentityProgress) => void,
    activation: ActivationMode,
  ): Promise<EstablishmentStepResult> {
    const isReconciliation = activation.reconciliation;
    if (!isReconciliation) report({ flow: "create", step: "signing_up" });
    // From here the homeserver may redeem the invite, so no later attempt may reuse it.
    this.forgetUnspentSignupInvite(googleAccount, signupDetails);
    LOGGER.info("identity.google.signup.started");
    const signedUp = await this.pubky.signup(
      identity.keyHandle,
      signupDetails.homeserverPubky,
      signupDetails.signupToken,
    );
    if (
      Result.isError(signedUp) &&
      signedUp.error.code !== "account_exists" &&
      signedUp.error.code !== "signup_uncertain"
    ) {
      return Result.err({ code: "signup_failed", cause: signedUp.error });
    }
    const signupWasUncertain =
      Result.isError(signedUp) && signedUp.error.code === "signup_uncertain";
    LOGGER.info("identity.google.signup.completed", {
      status: Result.isError(signedUp) ? signedUp.error.code : "created",
    });
    if (!activation.reconciliation && !Result.isError(signedUp)) {
      return this.activateAfterSignup(
        identity,
        signupDetails,
        googleAccount,
        report,
        activation.onBackgroundRepublish,
      );
    }

    report(
      isReconciliation
        ? { flow: "repair", step: "publishing" }
        : { flow: "create", step: "publishing" },
    );
    LOGGER.info("identity.google.publication.started");
    const published = await this.pubky.publishHomeserver(
      identity.keyHandle,
      signupDetails.homeserverPubky,
    );
    if (Result.isError(published) && published.error.code !== "publish_failed") {
      return Result.err({ code: "publication_failed", cause: published.error });
    }
    const publicationWasUncertain = Result.isError(published);
    if (!publicationWasUncertain) LOGGER.info("identity.google.publication.completed");

    report(
      isReconciliation
        ? { flow: "repair", step: "signing_in" }
        : { flow: "create", step: "activating" },
    );
    const signedIn = await this.pubky.signin(identity.keyHandle, "after-publication");
    if (Result.isError(signedIn)) {
      return Result.err({
        code: signupWasUncertain
          ? "signup_failed"
          : publicationWasUncertain
            ? "publication_failed"
            : "signin_failed",
        cause: signedIn.error,
      });
    }
    const verified = this.verifySessionIdentity(identity, signedIn.value.publicIdentity);
    if (Result.isError(verified)) return Result.err(verified.error);
    // A new key's account is always new. A repaired identity keeps its existing account and
    // profile unless this signup definitively created an account for it. Either way its record
    // was just published to this homeserver.
    const accountCreated = !isReconciliation || !Result.isError(signedUp);
    return this.saveIdentity(
      identity,
      googleAccount,
      accountCreated ? "homeserver_signup" : "restored",
      signupDetails.homeserverPubky,
    );
  }

  /**
   * A definitive signup has already published PKDNS. The forced republish is insurance that
   * runs in the background; the caller must let it settle before freeing the key.
   */
  private async activateAfterSignup(
    identity: PubkyIdentityKey,
    signupDetails: HomeserverSignupDetails,
    googleAccount: GoogleAccountProfile,
    report: (progress: GoogleIdentityProgress) => void,
    onBackgroundRepublish: (republish: Promise<void>) => void,
  ): Promise<EstablishmentStepResult> {
    LOGGER.info("identity.google.publication.started", { background: true });
    const republish = startHomeserverRepublish(() =>
      this.pubky.publishHomeserver(identity.keyHandle, signupDetails.homeserverPubky),
    );
    this.homeserverRepublish = republish;
    onBackgroundRepublish(republish);

    report({ flow: "create", step: "activating" });
    const signedIn = await this.pubky.signin(identity.keyHandle, "normal");
    if (Result.isError(signedIn)) {
      return Result.err({ code: "signin_failed", cause: signedIn.error });
    }
    const verified = this.verifySessionIdentity(identity, signedIn.value.publicIdentity);
    if (Result.isError(verified)) return Result.err(verified.error);
    return this.saveIdentity(
      identity,
      googleAccount,
      "homeserver_signup",
      signupDetails.homeserverPubky,
    );
  }

  private verifySessionIdentity(
    identity: PubkyIdentityKey,
    sessionIdentity: PubkyPublicIdentity,
  ): EstablishmentStepResult {
    if (sessionIdentity.publicKeyZ32 === identity.publicIdentity.publicKeyZ32) {
      return Result.ok();
    }
    LOGGER.warn("identity.google.activation_identity.failed");
    return Result.err({ code: "identity_mismatch" });
  }

  /** `homeserverPubky` is the host this run signed the key up on; a restore does not know it. */
  private async saveIdentity(
    identity: PubkyIdentityKey,
    googleAccount: GoogleAccountProfile,
    activation: "homeserver_signup" | "restored",
    homeserverPubky?: string,
  ): Promise<EstablishmentStepResult> {
    LOGGER.info("identity.local_save.started", { activation });
    const secretKey = await this.pubky.exportSecretKey(identity.keyHandle);
    if (Result.isError(secretKey)) {
      return Result.err({ code: "local_save_failed", cause: secretKey.error });
    }
    try {
      const saved = this.repository.save(
        {
          publicIdentity: identity.publicIdentity,
          googleAccount,
          ...(activation === "homeserver_signup" ? { profileSetupRequired: true as const } : {}),
          ...(homeserverPubky ? { homeserverPubky } : {}),
        },
        secretKey.value,
      );
      if (Result.isError(saved)) {
        return Result.err({ code: "local_save_failed", cause: saved.error });
      }
      LOGGER.info("identity.local_save.completed", { activation });
      return Result.ok();
    } finally {
      secretKey.value.bytes.fill(0);
    }
  }

  /**
   * Reuses the invite an earlier attempt on this page obtained for this Google account and never
   * used, otherwise requests one from Homegate, which spends one of the account's Google
   * verifications. The invite stays unspent until a signup is attempted with it.
   */
  private async requestSignupToken(
    credentials: GoogleIdentityCredentials,
  ): Promise<EstablishmentStepResult<HomeserverSignupDetails>> {
    const googleSubject = credentials.googleAccount.googleSubject;
    const unspent = this.unspentSignupInvites.get(googleSubject);
    if (unspent) {
      LOGGER.info("identity.google.homeserver_signup_token.reused");
      return Result.ok(unspent);
    }
    LOGGER.info("identity.google.homeserver_signup_token.started");
    const signupDetails = await this.homegate.requestGoogleSignupToken(credentials.googleIdToken);
    if (Result.isError(signupDetails)) {
      return Result.err({
        code: "homeserver_signup_token_failed",
        detailCode: signupDetails.error.code,
        cause: signupDetails.error,
      });
    }
    this.unspentSignupInvites.set(googleSubject, signupDetails.value);
    LOGGER.info("identity.google.homeserver_signup_token.completed");
    return Result.ok(signupDetails.value);
  }

  /** Drops an invite once a signup may have redeemed it or its homeserver refused it. */
  private forgetUnspentSignupInvite(
    googleAccount: GoogleAccountProfile,
    signupDetails: HomeserverSignupDetails,
  ): void {
    if (this.unspentSignupInvites.get(googleAccount.googleSubject) === signupDetails) {
      this.unspentSignupInvites.delete(googleAccount.googleSubject);
    }
  }

  /**
   * Looks the Homegate invite up on its homeserver (read-only) before anything irreversible. A
   * homeserver that does not answer stops both flows and keeps the invite for the next attempt.
   * Creation also stops for an invite the homeserver reports used or unknown, since a new key
   * cannot own an account yet, and drops that invite; a repair continues, because the key's own
   * earlier signup may have spent it.
   */
  private async checkSignupHomeserver(
    googleAccount: GoogleAccountProfile,
    signupDetails: HomeserverSignupDetails,
    flow: "create" | "repair",
  ): Promise<EstablishmentStepResult> {
    LOGGER.info("identity.google.homeserver_check.started", { flow });
    const lookup = await this.signupTokens.lookUp(signupDetails, this.requests.signal);
    if (!lookup.reached) {
      LOGGER.warn("identity.google.homeserver_check.failed", { flow, code: "unreachable" });
      return Result.err({ code: "homeserver_unreachable" });
    }
    if (flow === "create" && (lookup.status === "used" || lookup.status === "not_found")) {
      LOGGER.warn("identity.google.homeserver_check.failed", { flow, code: lookup.status });
      this.forgetUnspentSignupInvite(googleAccount, signupDetails);
      return Result.err({ code: "homeserver_invite_rejected" });
    }
    LOGGER.info("identity.google.homeserver_check.completed", { flow, status: lookup.status });
    return Result.ok();
  }

  /** This Passport's normalized origin; `null` when unparseable, which never claims a file. */
  private ownOrigin(): string | null {
    const origin = normalizePassportFileOrigin(this.passportOrigin);
    return Result.isOk(origin) ? origin.value : null;
  }

  /** Whether this origin wrote the envelope. */
  private isOwnPassportFile(envelope: PassportFileEnvelope): boolean {
    const origin = this.ownOrigin();
    return origin !== null && origin === envelope.url;
  }

  private foreignPassportFileError(
    envelope: PassportFileEnvelope,
    cause: unknown,
  ): GoogleIdentityLifecycleError {
    LOGGER.warn("identity.google.foreign_passport_file", { passportFileOrigin: envelope.url });
    return { code: "foreign_passport_file", passportFileOrigin: envelope.url, cause };
  }

  private async requestWrappingKey(
    googleIdToken: string,
    envelope?: PassportFileEnvelope,
  ): Promise<EstablishmentStepResult<{ wrappingKey: string; keyId: string }>> {
    LOGGER.info("identity.google.wrapping_key.started");
    const wrappingKey = await this.wrappingKeys.requestGoogleWrappingKey(
      googleIdToken,
      envelope?.keyId,
    );
    if (Result.isError(wrappingKey)) {
      return Result.err({
        code: "wrapping_key_failed",
        detailCode: wrappingKey.error.code,
        cause: wrappingKey.error,
      });
    }
    LOGGER.info("identity.google.wrapping_key.completed");
    return Result.ok(wrappingKey.value);
  }

  /**
   * Confirms this browser still holds the identity's key and that its record is bound to the
   * expected Google account. The secret bytes read for this check are zeroed immediately.
   */
  private verifyLocalIdentityBinding(
    publicIdentity: PubkyPublicIdentity,
    expectedGoogleSubject: string,
  ): EstablishmentStepResult {
    const local = this.readLocalIdentityMetadata(publicIdentity);
    if (Result.isError(local)) return Result.err(local.error);
    if (local.value.googleAccount?.googleSubject !== expectedGoogleSubject) {
      LOGGER.warn("identity.google.detach.failed", {
        stage: "local_identity",
        code: "local_identity_not_bound",
      });
      return Result.err({ code: "local_identity_not_bound" });
    }
    return Result.ok();
  }

  /**
   * The single translation of local-repository read failures. The caller owns the returned
   * secret bytes and must zero them.
   */
  private readLocalIdentity(
    publicIdentity: PubkyPublicIdentity,
  ): EstablishmentStepResult<LocalIdentityRecord> {
    const local = this.repository.read(publicIdentity.publicKeyZ32);
    if (Result.isOk(local)) return Result.ok(local.value);
    LOGGER.warn("identity.google.local_identity.failed", {
      code: "local_identity_unavailable",
      localCode: local.error.code,
    });
    return Result.err({ code: "local_identity_unavailable", cause: local.error });
  }

  /** Reads the identity's local metadata; the secret bytes read with it are zeroed at once. */
  private readLocalIdentityMetadata(
    publicIdentity: PubkyPublicIdentity,
  ): EstablishmentStepResult<LocalIdentityMetadata> {
    const local = this.readLocalIdentity(publicIdentity);
    if (Result.isError(local)) return Result.err(local.error);
    local.value.secretKey.bytes.fill(0);
    return Result.ok(local.value.identity);
  }

  /** Reads the local secret key only to encrypt it, and zeroes it once encryption settles. */
  private async encryptLocalSecretKey(
    publicIdentity: PubkyPublicIdentity,
    wrappingKey: { wrappingKey: string; keyId: string },
  ): Promise<EstablishmentStepResult<PassportFileEnvelope>> {
    const local = this.readLocalIdentity(publicIdentity);
    if (Result.isError(local)) return Result.err(local.error);
    LOGGER.info("identity.google.encrypt.started");
    const encrypted = await this.crypto
      .encryptSecretKeyBytes(
        local.value.secretKey.bytes,
        wrappingKey.wrappingKey,
        this.passportOrigin,
        wrappingKey.keyId,
      )
      .finally(() => {
        local.value.secretKey.bytes.fill(0);
      });
    if (Result.isError(encrypted)) {
      return Result.err({ code: "encrypt_failed", cause: encrypted.error });
    }
    LOGGER.info("identity.google.encrypt.completed");
    return Result.ok(encrypted.value);
  }

  /**
   * Records the Google association for a backup that already exists in Drive. A second
   * attempt covers transient storage failures; after that the backup is remembered as
   * unlinked so a later attempt can finish the link without touching Drive.
   */
  private linkGoogleAccount(
    publicIdentity: PubkyPublicIdentity,
    googleAccount: GoogleAccountProfile,
    visibleRecoveryCopyStatus: VisibleRecoveryCopyStatus,
  ): EstablishmentStepResult<GoogleIdentityBackup> {
    const key = unlinkedBackupKey(googleAccount, publicIdentity);
    let linked = this.repository.setGoogleAccount(publicIdentity.publicKeyZ32, googleAccount);
    if (Result.isError(linked)) {
      LOGGER.warn("identity.google.backup.link.retrying", { code: linked.error.code });
      linked = this.repository.setGoogleAccount(publicIdentity.publicKeyZ32, googleAccount);
    }
    if (Result.isError(linked)) {
      this.unlinkedBackups.set(key, visibleRecoveryCopyStatus);
      LOGGER.warn("identity.google.backup.failed", {
        code: "google_backup_created_not_linked",
        localCode: linked.error.code,
      });
      return Result.err({ code: "google_backup_created_not_linked", cause: linked.error });
    }
    this.unlinkedBackups.delete(key);
    return Result.ok({ googleAccount, visibleRecoveryCopyStatus });
  }

  private async deleteVerifiedGoogleDriveFiles(
    credentials: GoogleIdentityCredentials,
    publicIdentity: PubkyPublicIdentity,
  ): Promise<DetachGoogleIdentityResult> {
    const store = this.createDriveStore(credentials.driveAccessToken, this.fetch);
    const storedFile = await store.readPassportFile();
    if (Result.isError(storedFile)) {
      return Result.err({ code: "google_drive_cleanup_failed", cause: storedFile.error });
    }

    if (storedFile.value.status === "found") {
      const wrappingKey = await this.wrappingKeys.requestGoogleWrappingKey(
        credentials.googleIdToken,
        storedFile.value.envelope.keyId,
      );
      if (Result.isError(wrappingKey)) {
        return Result.err({ code: "google_drive_cleanup_failed", cause: wrappingKey.error });
      }
      const restored = await this.restoreKey(
        storedFile.value.envelope,
        wrappingKey.value.wrappingKey,
      );
      if (Result.isError(restored)) {
        return Result.err({ code: "google_drive_cleanup_failed", cause: restored.error });
      }
      try {
        if (restored.value.publicIdentity.publicKeyZ32 !== publicIdentity.publicKeyZ32) {
          LOGGER.warn("identity.google.delete.failed", {
            stage: "identity_validation",
            code: "identity_mismatch",
          });
          return Result.err({ code: "google_drive_cleanup_failed" });
        }
      } finally {
        this.disposeIdentityKey(restored.value, "deleted_key_dispose");
      }
    }

    const visibleCopies = this.createVisibleRecoveryCopies(
      credentials.driveAccessToken,
      this.fetch,
    );
    const deletedVisibleCopies = await visibleCopies.deleteVisibleRecoveryCopies(publicIdentity);
    if (Result.isError(deletedVisibleCopies)) {
      return Result.err({ code: "google_drive_cleanup_failed", cause: deletedVisibleCopies.error });
    }
    if (storedFile.value.status === "missing") return Result.ok();

    const deleted = await store.deletePassportFile(storedFile.value.reference);
    return Result.isError(deleted)
      ? Result.err({ code: "google_drive_cleanup_failed", cause: deleted.error })
      : Result.ok();
  }

  private async createVisibleRecoveryCopy(
    visibleCopies: VisibleRecoveryCopiesPort,
    envelope: PassportFileEnvelope,
    publicIdentity: PubkyPublicIdentity,
  ): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      let finishTimeout!: () => void;
      const deadline = new Promise<undefined>((resolve) => {
        finishTimeout = () => resolve(undefined);
      });
      timeout = setTimeout(() => {
        controller.abort();
        finishTimeout();
      }, REQUEST_TIMEOUT_MS);
      const result = await Promise.race([
        visibleCopies.createVisibleRecoveryCopy(envelope, publicIdentity, controller.signal),
        deadline,
      ]);
      if (result === undefined) return false;
      if (Result.isOk(result)) return true;
      LOGGER.warn("identity.google.visible_recovery_copy.failed", {
        stage: "create",
        code: result.error.code,
        ...safeErrorLogFields(result.error),
      });
      return false;
    } catch (e) {
      LOGGER.warn("identity.google.visible_recovery_copy.failed", {
        stage: "create",
        ...safeErrorLogFields(e),
      });
      return false;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private disposeIdentityKey(
    identity: PubkyIdentityKey,
    operation: "created_key_dispose" | "restored_key_dispose" | "deleted_key_dispose",
  ): void {
    try {
      this.pubky.disposeIdentityKey(identity.keyHandle);
    } catch (e) {
      LOGGER.warn("identity.google.cleanup.failed", {
        operation,
        ...safeErrorLogFields(e),
      });
    }
  }
}

function unlinkedBackupKey(
  googleAccount: GoogleAccountProfile,
  publicIdentity: PubkyPublicIdentity,
): string {
  return `${googleAccount.googleSubject}\n${publicIdentity.publicKeyZ32}`;
}

/** Authentication or plaintext failures: the wrapping key does not open this envelope. */
function isKeyMismatch(code: string): boolean {
  return code === "decrypt_failed" || code === "invalid_plaintext";
}
