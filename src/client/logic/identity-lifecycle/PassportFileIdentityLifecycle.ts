import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { AppleAccount } from "@/libs/appleAccount";
import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { NETWORK_OPERATION_TIMEOUT_MS } from "@/libs/passportPolicy";
import type { CodedFailure } from "@/libs/result";
import type {
  HomegateSignupTokenErrorCode,
  HomeserverSignupDetails,
} from "@/client/logic/homegate/HomegateClient";
import {
  serializePassportFileEnvelope,
  type PassportFileEnvelope,
} from "@/client/logic/passport-file/passportFileEnvelope";
import type { PassportFileStore } from "@/client/logic/passport-file/passportFileStore";
import { PassportFileWebCrypto } from "@/client/logic/passport-file/PassportFileWebCrypto";
import {
  PUBKY_SECRET_KEY_FORMAT,
  type PubkyIdentityKey,
  type PubkyPublicIdentity,
} from "@/client/logic/pubky/pubkyIdentityKey";
import { startHomeserverRepublish } from "@/client/logic/pubky/startHomeserverRepublish";
import { PubkySdkAdapter } from "@/client/logic/pubky/PubkySdkAdapter";
import {
  WrappingKeyApiClient,
  type WrappingKeyErrorCode,
  type WrappingKeyProvider,
} from "@/client/logic/wrapping-key/WrappingKeyApiClient";
import { LocalStorageIdentityRepository } from "@/client/logic/local-identity/LocalStorageIdentityRepository";

/** Safe setup or restore progress emitted while establishing an identity. */
export type IdentityProgress =
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

/** The sign-in account saved with a local identity. */
export type LocalIdentityAccount =
  { googleAccount: GoogleAccountProfile } | { appleAccount: AppleAccount };

/** Failures shared by every provider that stores an encrypted Passport file. */
export type IdentityLifecycleError =
  | {
      code: "wrapping_key_failed";
      detailCode: WrappingKeyErrorCode;
      cause?: unknown;
    }
  | {
      code: "homeserver_signup_token_failed";
      detailCode: HomegateSignupTokenErrorCode;
      cause?: unknown;
    }
  | CodedFailure<
      | "create_failed"
      | "decrypt_failed"
      | "encrypt_failed"
      | "homeserver_not_found"
      | "identity_already_linked"
      | "identity_linked_meanwhile"
      | "identity_mismatch"
      | "local_identity_unavailable"
      | "local_link_failed"
      | "local_save_failed"
      | "provider_account_in_use"
      | "publication_failed"
      | "restore_failed"
      | "signin_failed"
      | "signup_failed"
      | "unexpected_failure"
    >;

export type StepResult<Success = void, Failure = IdentityLifecycleError> = ResultType<
  Success,
  Failure
>;

/** How an attach ended: a new Passport file was written, or the account already held this pubky. */
export type IdentityAttachment = "created" | "linked";

type AttachInput<Reference, StoreFailure extends { code: string }, StoreError> = {
  account: LocalIdentityAccount;
  publicIdentity: PubkyPublicIdentity;
  idToken: string;
  store: PassportFileStore<Reference, StoreFailure>;
  readFailure: (error: StoreFailure) => StoreError;
  writeFailure: (error: StoreFailure) => StoreError;
  onCreated?: (envelope: PassportFileEnvelope) => void;
};

type SignupTokenRequest = () => Promise<StepResult<HomeserverSignupDetails>>;

/**
 * How {@link PassportFileIdentityLifecycle.signupAndActivate} treats a definitive signup: a new
 * identity republishes PKDNS in the background and signs in at once, a reconciliation keeps the
 * awaited publish and blocking sign-in.
 */
type ActivationMode =
  | { reconciliation: true }
  | { reconciliation: false; onBackgroundRepublish: (republish: Promise<void>) => void };

/** Collaborators the lifecycle otherwise constructs itself; every member is optional. */
export type PassportFileIdentityLifecycleDependencies = {
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
  repository?: Pick<LocalStorageIdentityRepository, "save" | "remove">;
  /** Reads and links identities already in this browser; defaults to the same storage. */
  identities?: Pick<LocalStorageIdentityRepository, "list" | "read" | "linkProviderAccount">;
  wrappingKeys?: Pick<WrappingKeyApiClient, "requestWrappingKey">;
};

/**
 * Provider-neutral identity work around an encrypted Passport file: create a key, encrypt it,
 * hand the envelope to the provider's file store, sign up and activate; or decrypt a found
 * envelope, sign in and repair an interrupted setup. Subclasses own the provider's credentials
 * and file store.
 *
 * Construction can throw when a required browser dependency cannot be initialized; an owned
 * Pubky adapter is released before the error propagates. After a successful constructor,
 * {@link dispose} always disposes `this.pubky`.
 */
export abstract class PassportFileIdentityLifecycle {
  protected readonly repository: NonNullable<
    PassportFileIdentityLifecycleDependencies["repository"]
  >;
  protected readonly pubky: NonNullable<PassportFileIdentityLifecycleDependencies["pubky"]>;
  protected readonly crypto: NonNullable<PassportFileIdentityLifecycleDependencies["crypto"]>;
  protected readonly wrappingKeys: NonNullable<
    PassportFileIdentityLifecycleDependencies["wrappingKeys"]
  >;
  private readonly identities: NonNullable<PassportFileIdentityLifecycleDependencies["identities"]>;
  /** Browser fetch bound to this lifecycle's abort signal and network timeout. */
  protected readonly fetch: typeof fetch;
  private readonly requests = new AbortController();
  private readonly ownsPubky: boolean;
  private homeserverRepublish: Promise<void> | undefined;
  private disposed = false;

  /** @throws {Error} when a required dependency cannot be initialized. */
  protected constructor(
    protected readonly provider: WrappingKeyProvider,
    protected readonly passportOrigin: string,
    dependencies: PassportFileIdentityLifecycleDependencies,
  ) {
    this.ownsPubky = dependencies.pubky === undefined;
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
    const localStorageRepository = new LocalStorageIdentityRepository();
    this.repository = dependencies.repository ?? localStorageRepository;
    this.identities = dependencies.identities ?? localStorageRepository;
    try {
      this.wrappingKeys =
        dependencies.wrappingKeys ?? new WrappingKeyApiClient(this.fetch, provider);
      this.crypto = dependencies.crypto ?? new PassportFileWebCrypto();
    } catch (e) {
      this.releaseOwnedPubkyAfterConstructionFailure();
      throw e;
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

  /** For subclasses whose own construction fails after this constructor succeeded. */
  protected releaseOwnedPubkyAfterConstructionFailure(): void {
    if (!this.ownsPubky) return;
    try {
      this.pubky.dispose();
    } catch (e) {
      LOGGER.warn(`identity.${this.provider}.cleanup.failed`, {
        operation: "construction_pubky_dispose",
        ...safeErrorLogFields(e),
      });
    }
  }

  /**
   * Creates a key, encrypts it and persists the envelope through `persist` before attempting
   * homeserver activation. Once that authoritative file exists it is preserved on every later
   * failure. `onPersisted` starts optional provider work that must not block activation.
   */
  protected async createIdentity<PersistError>(input: {
    account: LocalIdentityAccount;
    signupDetails: HomeserverSignupDetails;
    wrappingKey: string;
    keyId: string;
    report: (progress: IdentityProgress) => void;
    persist: (envelope: PassportFileEnvelope) => Promise<StepResult<void, PersistError>>;
    onPersisted?: (envelope: PassportFileEnvelope, publicIdentity: PubkyPublicIdentity) => void;
  }): Promise<
    StepResult<{ publicIdentity: PubkyPublicIdentity }, IdentityLifecycleError | PersistError>
  > {
    const event = `identity.${this.provider}`;
    LOGGER.info(`${event}.create.started`);
    LOGGER.info(`${event}.create_key.started`);
    const created = await this.pubky.createIdentityKey();
    if (Result.isError(created)) {
      return Result.err({ code: "create_failed", cause: created.error });
    }
    LOGGER.info(`${event}.create_key.completed`);

    const background: { republish: Promise<void> | undefined } = { republish: undefined };
    try {
      const secretKey = await this.pubky.exportSecretKey(created.value.keyHandle);
      if (Result.isError(secretKey)) {
        return Result.err({ code: "create_failed", cause: secretKey.error });
      }

      input.report({ flow: "create", step: "storing_passport_file" });
      LOGGER.info(`${event}.encrypt.started`);
      const encrypted = await this.crypto
        .encryptSecretKeyBytes(
          secretKey.value.bytes,
          input.wrappingKey,
          this.passportOrigin,
          input.keyId,
        )
        .finally(() => {
          secretKey.value.bytes.fill(0);
        });
      if (Result.isError(encrypted)) {
        return Result.err({ code: "encrypt_failed", cause: encrypted.error });
      }
      const envelope = encrypted.value;
      LOGGER.info(`${event}.encrypt.completed`);

      const persisted = await input.persist(envelope);
      if (Result.isError(persisted)) return Result.err(persisted.error);
      input.onPersisted?.(envelope, created.value.publicIdentity);

      const activated = await this.signupAndActivate(
        created.value,
        input.signupDetails,
        input.account,
        input.report,
        {
          reconciliation: false,
          onBackgroundRepublish: (republish) => {
            background.republish = republish;
          },
        },
      );
      if (Result.isError(activated)) return Result.err(activated.error);
      return Result.ok({ publicIdentity: created.value.publicIdentity });
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

  /**
   * Restores one identity and signs in normally before attempting PKDNS and
   * homeserver repair for an interrupted setup. An attached identity lives on a homeserver
   * Passport did not choose, so it is never repaired: without a record it is
   * `homeserver_not_found`, like an import.
   */
  protected async restoreIdentity(input: {
    account: LocalIdentityAccount;
    envelope: PassportFileEnvelope;
    wrappingKey: string;
    report: (progress: IdentityProgress) => void;
    requestSignupToken: SignupTokenRequest;
  }): Promise<StepResult<{ publicIdentity: PubkyPublicIdentity }>> {
    const { account, report } = input;
    report({ flow: "restore", step: "restoring" });
    const restored = await this.restoreKey(input.envelope, input.wrappingKey);
    if (Result.isError(restored)) return Result.err(restored.error);

    let republish: Promise<void> | undefined;
    try {
      report({ flow: "restore", step: "signing_in" });
      const signedIn = await this.pubky.signin(restored.value.keyHandle, "normal");
      if (!Result.isError(signedIn)) {
        const verified = this.verifySessionIdentity(restored.value, signedIn.value.publicIdentity);
        if (Result.isError(verified)) return Result.err(verified.error);
        const saved = await this.saveIdentity(restored.value, account, "restored");
        if (Result.isError(saved)) return Result.err(saved.error);
        this.homeserverRepublish = startHomeserverRepublish(() =>
          this.pubky.publishHomeserver(restored.value.keyHandle),
        );
        republish = this.homeserverRepublish;
        return Result.ok({ publicIdentity: restored.value.publicIdentity });
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
      if (input.envelope.attached === true) {
        LOGGER.warn(`identity.${this.provider}.restore.failed`, { code: "homeserver_not_found" });
        return Result.err({ code: "homeserver_not_found" });
      }

      report({ flow: "repair", step: "signing_up" });
      const signupDetails = await input.requestSignupToken();
      if (Result.isError(signupDetails)) return Result.err(signupDetails.error);
      const activated = await this.signupAndActivate(
        restored.value,
        signupDetails.value,
        account,
        report,
        { reconciliation: true },
      );
      if (Result.isError(activated)) return Result.err(activated.error);
      return Result.ok({ publicIdentity: restored.value.publicIdentity });
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

  /**
   * Gives an identity that is only in this browser the provider's normal backup. The provider
   * file decides: missing, this identity's own key is wrapped and stored as a new file; found
   * with the same pubky, only the local link is added; found with another pubky, nothing is
   * written or deleted. A file that appears while creating one (`create_conflict`) is read again
   * once. The homeserver is never touched: the account already exists.
   */
  protected async attachToPassportFile<
    Reference,
    StoreFailure extends { code: string },
    StoreError,
  >(
    input: AttachInput<Reference, StoreFailure, StoreError>,
  ): Promise<StepResult<IdentityAttachment, IdentityLifecycleError | StoreError>> {
    const attach = () => this.attachWithoutOtherTabs(input);
    // One attach per pubky across this browser's tabs: a second tab waits, then sees the link.
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!locks) return attach();
    try {
      return await locks.request(
        `pubky-passport:attach:${input.publicIdentity.publicKeyZ32}`,
        attach,
      );
    } catch (e) {
      LOGGER.warn(`identity.${this.provider}.attach.failed`, {
        code: "unexpected_failure",
        stage: "lock",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "unexpected_failure", cause: e });
    }
  }

  private async attachWithoutOtherTabs<
    Reference,
    StoreFailure extends { code: string },
    StoreError,
  >(
    input: AttachInput<Reference, StoreFailure, StoreError>,
  ): Promise<StepResult<IdentityAttachment, IdentityLifecycleError | StoreError>> {
    const event = `identity.${this.provider}.attach`;
    LOGGER.info(`${event}.started`);
    const local = this.checkAttachable(input.publicIdentity, input.account);
    if (Result.isError(local)) return Result.err(local.error);

    let conflict: StoreFailure | undefined;
    let ours: PassportFileEnvelope | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const storedFile = await input.store.readPassportFile();
      if (Result.isError(storedFile)) {
        return Result.err(
          conflict
            ? this.afterConflict(input, conflict, storedFile.error.code)
            : input.readFailure(storedFile.error),
        );
      }

      if (storedFile.value.status === "found") {
        const owner = await this.passportFileOwner(input.idToken, storedFile.value.envelope);
        if (Result.isError(owner)) {
          return Result.err(
            conflict ? this.afterConflict(input, conflict, owner.error.code) : owner.error,
          );
        }
        if (owner.value !== input.publicIdentity.publicKeyZ32) {
          LOGGER.warn(`${event}.failed`, { code: "provider_account_in_use" });
          return Result.err({ code: "provider_account_in_use" });
        }
        // Each write uses a fresh IV, so the same envelope after a conflict is our own upload.
        if (ours && isSameEnvelope(storedFile.value.envelope, ours)) {
          input.onCreated?.(ours);
          return this.linkAccount(input.publicIdentity, input.account, "created");
        }
        return this.linkAccount(input.publicIdentity, input.account, "linked");
      }
      // A conflict means a file appeared, or that our own new file is not listed yet. Writing
      // again could leave two files, so after a conflict only a found file counts.
      if (conflict) return Result.err(input.writeFailure(conflict));

      const envelope = await this.wrapLocalKey(input.publicIdentity, input.idToken);
      if (Result.isError(envelope)) return Result.err(envelope.error);
      LOGGER.info(`${event}.write.started`);
      const written = await input.store.createPassportFile(envelope.value);
      if (Result.isError(written)) {
        if (written.error.code !== "create_conflict") {
          return Result.err(input.writeFailure(written.error));
        }
        // Another tab or device wrote a file meanwhile, or ours is not listed yet: decide again
        // from what is there now.
        conflict = written.error;
        ours = envelope.value;
        continue;
      }
      LOGGER.info(`${event}.write.completed`);
      input.onCreated?.(envelope.value);
      return this.linkAccount(input.publicIdentity, input.account, "created");
    }
    // Not reached: the second pass always returns.
    return Result.err({ code: "unexpected_failure" });
  }

  /**
   * After a create conflict our own file may already be stored, so a failure while reading again
   * reports the conflict: the screen then never claims that nothing changed.
   */
  private afterConflict<Reference, StoreFailure extends { code: string }, StoreError>(
    input: AttachInput<Reference, StoreFailure, StoreError>,
    conflict: StoreFailure,
    rereadCode: string,
  ): StoreError {
    LOGGER.warn(`identity.${this.provider}.attach.failed`, {
      code: "create_conflict",
      stage: "reread",
      rereadCode,
    });
    return input.writeFailure(conflict);
  }

  /**
   * The identity must still be in this browser without a sign-in account, and no other identity
   * here may already use this account: Passport keeps one pubky per account.
   */
  private checkAttachable(
    publicIdentity: PubkyPublicIdentity,
    account: LocalIdentityAccount,
  ): StepResult {
    const catalog = this.identities.list();
    if (Result.isError(catalog)) {
      return Result.err({ code: "local_identity_unavailable", cause: catalog.error });
    }
    const subject = accountSubject(account);
    let found = false;
    for (const identity of catalog.value.identities) {
      const linked = identity.googleAccount
        ? `google:${identity.googleAccount.googleSubject}`
        : identity.appleAccount
          ? `apple:${identity.appleAccount.appleSubject}`
          : undefined;
      if (identity.publicIdentity.publicKeyZ32 === publicIdentity.publicKeyZ32) {
        found = true;
        if (linked !== undefined && linked !== subject) {
          return Result.err({ code: "identity_already_linked" });
        }
      } else if (linked === subject) {
        LOGGER.warn(`identity.${this.provider}.attach.failed`, {
          code: "provider_account_in_use",
          stage: "local",
        });
        return Result.err({ code: "provider_account_in_use" });
      }
    }
    return found ? Result.ok() : Result.err({ code: "local_identity_unavailable" });
  }

  /** Decrypts a found file only to learn which pubky it holds; the key is released at once. */
  private async passportFileOwner(
    idToken: string,
    envelope: PassportFileEnvelope,
  ): Promise<StepResult<string>> {
    const wrappingKey = await this.requestWrappingKey(idToken, envelope);
    if (Result.isError(wrappingKey)) return Result.err(wrappingKey.error);
    const restored = await this.restoreKey(envelope, wrappingKey.value.wrappingKey);
    if (Result.isError(restored)) return Result.err(restored.error);
    const owner = restored.value.publicIdentity.publicKeyZ32;
    this.disposeIdentityKey(restored.value, "restored_key_dispose");
    return Result.ok(owner);
  }

  /**
   * Encrypts this browser's key for the identity as a new setup encrypts a new key, marked
   * `attached` so restore never signs it up on Passport's homeserver. The stored key must derive
   * the expected pubky, so a damaged record can never be uploaded.
   */
  private async wrapLocalKey(
    publicIdentity: PubkyPublicIdentity,
    idToken: string,
  ): Promise<StepResult<PassportFileEnvelope>> {
    const event = `identity.${this.provider}.attach`;
    const wrappingKey = await this.requestWrappingKey(idToken);
    if (Result.isError(wrappingKey)) return Result.err(wrappingKey.error);

    const stored = this.identities.read(publicIdentity.publicKeyZ32);
    if (Result.isError(stored)) {
      return Result.err({ code: "local_identity_unavailable", cause: stored.error });
    }
    // The adapter consumes and clears these bytes.
    const restored = await this.pubky.restoreIdentityKey(stored.value.secretKey);
    if (Result.isError(restored))
      return Result.err({ code: "restore_failed", cause: restored.error });
    try {
      if (restored.value.publicIdentity.publicKeyZ32 !== publicIdentity.publicKeyZ32) {
        LOGGER.warn(`${event}.failed`, { code: "identity_mismatch", stage: "local_key" });
        return Result.err({ code: "identity_mismatch" });
      }
      const secretKey = await this.pubky.exportSecretKey(restored.value.keyHandle);
      if (Result.isError(secretKey)) {
        return Result.err({ code: "encrypt_failed", cause: secretKey.error });
      }
      LOGGER.info(`${event}.encrypt.started`);
      const encrypted = await this.crypto
        .encryptSecretKeyBytes(
          secretKey.value.bytes,
          wrappingKey.value.wrappingKey,
          this.passportOrigin,
          wrappingKey.value.keyId,
          { attached: true },
        )
        .finally(() => {
          secretKey.value.bytes.fill(0);
        });
      if (Result.isError(encrypted)) {
        return Result.err({ code: "encrypt_failed", cause: encrypted.error });
      }
      LOGGER.info(`${event}.encrypt.completed`);
      return Result.ok(encrypted.value);
    } finally {
      this.disposeIdentityKey(restored.value, "restored_key_dispose");
    }
  }

  private linkAccount(
    publicIdentity: PubkyPublicIdentity,
    account: LocalIdentityAccount,
    attachment: IdentityAttachment,
  ): StepResult<IdentityAttachment> {
    const linked = this.identities.linkProviderAccount(publicIdentity.publicKeyZ32, account);
    if (Result.isError(linked)) {
      return Result.err({
        code:
          linked.error.code === "provider_conflict" || linked.error.code === "provider_in_use"
            ? "identity_linked_meanwhile"
            : "local_link_failed",
        cause: linked.error,
      });
    }
    LOGGER.info(`identity.${this.provider}.attach.completed`, { attachment });
    return Result.ok(attachment);
  }

  /** Decrypts exactly 32 secret bytes; the Pubky adapter consumes and clears them during restoration. */
  protected async restoreKey(
    envelope: PassportFileEnvelope,
    wrappingKey: string,
  ): Promise<StepResult<PubkyIdentityKey>> {
    const event = `identity.${this.provider}`;
    LOGGER.info(`${event}.decrypt.started`);
    const secretKey = await this.crypto.decryptSecretKeyBytes(
      envelope,
      wrappingKey,
      this.passportOrigin,
    );
    if (Result.isError(secretKey)) {
      return Result.err({ code: "decrypt_failed", cause: secretKey.error });
    }

    const restored = await this.pubky.restoreIdentityKey({
      bytes: secretKey.value,
      format: PUBKY_SECRET_KEY_FORMAT,
    });
    if (Result.isError(restored)) {
      return Result.err({ code: "restore_failed", cause: restored.error });
    }
    LOGGER.info(`${event}.restore.completed`);
    return Result.ok(restored.value);
  }

  protected async requestWrappingKey(
    idToken: string,
    envelope?: PassportFileEnvelope,
  ): Promise<StepResult<{ wrappingKey: string; keyId: string }>> {
    const event = `identity.${this.provider}`;
    LOGGER.info(`${event}.wrapping_key.started`);
    const wrappingKey = await this.wrappingKeys.requestWrappingKey(idToken, envelope?.keyId);
    if (Result.isError(wrappingKey)) {
      return Result.err({
        code: "wrapping_key_failed",
        detailCode: wrappingKey.error.code,
        cause: wrappingKey.error,
      });
    }
    LOGGER.info(`${event}.wrapping_key.completed`);
    return Result.ok(wrappingKey.value);
  }

  protected disposeIdentityKey(
    identity: PubkyIdentityKey,
    operation: "created_key_dispose" | "restored_key_dispose" | "deleted_key_dispose",
  ): void {
    try {
      this.pubky.disposeIdentityKey(identity.keyHandle);
    } catch (e) {
      LOGGER.warn(`identity.${this.provider}.cleanup.failed`, {
        operation,
        ...safeErrorLogFields(e),
      });
    }
  }

  /**
   * Shared activation for new and interrupted identities. The SDK's signup publishes PKDNS
   * itself, so a definitive new signup only republishes in the background and checks that the
   * record resolves, without a sign-in. Signup conflict means the account already exists.
   * Ambiguous signup or publication failures are verified through blocking sign-in before they
   * are treated as fatal.
   */
  private async signupAndActivate(
    identity: PubkyIdentityKey,
    signupDetails: HomeserverSignupDetails,
    account: LocalIdentityAccount,
    report: (progress: IdentityProgress) => void,
    activation: ActivationMode,
  ): Promise<StepResult> {
    const event = `identity.${this.provider}`;
    const isReconciliation = activation.reconciliation;
    if (!isReconciliation) report({ flow: "create", step: "signing_up" });
    LOGGER.info(`${event}.signup.started`);
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
    LOGGER.info(`${event}.signup.completed`, {
      status: Result.isError(signedUp) ? signedUp.error.code : "created",
    });
    if (!activation.reconciliation && !Result.isError(signedUp)) {
      return this.activateAfterSignup(
        identity,
        signupDetails,
        account,
        report,
        activation.onBackgroundRepublish,
      );
    }

    report(
      isReconciliation
        ? { flow: "repair", step: "publishing" }
        : { flow: "create", step: "publishing" },
    );
    LOGGER.info(`${event}.publication.started`);
    const published = await this.pubky.publishHomeserver(
      identity.keyHandle,
      signupDetails.homeserverPubky,
    );
    if (Result.isError(published) && published.error.code !== "publish_failed") {
      return Result.err({ code: "publication_failed", cause: published.error });
    }
    const publicationWasUncertain = Result.isError(published);
    if (!publicationWasUncertain) LOGGER.info(`${event}.publication.completed`);

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
    return this.saveIdentity(identity, account, "homeserver_signup");
  }

  /**
   * A definitive signup has already published PKDNS. The forced republish is insurance that
   * runs in the background; the caller must let it settle before freeing the key. Activation
   * only checks the record resolves; it opens no homeserver session.
   */
  private async activateAfterSignup(
    identity: PubkyIdentityKey,
    signupDetails: HomeserverSignupDetails,
    account: LocalIdentityAccount,
    report: (progress: IdentityProgress) => void,
    onBackgroundRepublish: (republish: Promise<void>) => void,
  ): Promise<StepResult> {
    LOGGER.info(`identity.${this.provider}.publication.started`, { background: true });
    const republish = startHomeserverRepublish(() =>
      this.pubky.publishHomeserver(identity.keyHandle, signupDetails.homeserverPubky),
    );
    this.homeserverRepublish = republish;
    onBackgroundRepublish(republish);

    report({ flow: "create", step: "activating" });
    // The signup created the account and published PKDNS. Check the record resolves, as the
    // sign-in this replaces did first, without opening a session: a session would add a
    // Passport grant on the homeserver that has to be signed out again.
    const resolved = await this.pubky.resolveHomeserver(identity.publicIdentity.publicKeyZ32);
    if (Result.isError(resolved)) {
      return Result.err({ code: "signin_failed", cause: resolved.error });
    }
    if (resolved.value === null) {
      LOGGER.warn(`identity.${this.provider}.activation_resolution.failed`);
      return Result.err({ code: "signin_failed" });
    }
    return this.saveIdentity(identity, account, "homeserver_signup");
  }

  private verifySessionIdentity(
    identity: PubkyIdentityKey,
    sessionIdentity: PubkyPublicIdentity,
  ): StepResult {
    if (sessionIdentity.publicKeyZ32 === identity.publicIdentity.publicKeyZ32) {
      return Result.ok();
    }
    LOGGER.warn(`identity.${this.provider}.activation_identity.failed`);
    return Result.err({ code: "identity_mismatch" });
  }

  private async saveIdentity(
    identity: PubkyIdentityKey,
    account: LocalIdentityAccount,
    activation: "homeserver_signup" | "restored",
  ): Promise<StepResult> {
    LOGGER.info("identity.local_save.started", { activation });
    const secretKey = await this.pubky.exportSecretKey(identity.keyHandle);
    if (Result.isError(secretKey)) {
      return Result.err({ code: "local_save_failed", cause: secretKey.error });
    }
    try {
      const saved = this.repository.save(
        { publicIdentity: identity.publicIdentity, ...account },
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
}

function isSameEnvelope(a: PassportFileEnvelope, b: PassportFileEnvelope): boolean {
  const serialized = serializePassportFileEnvelope(a);
  return serialized !== null && serialized === serializePassportFileEnvelope(b);
}

function accountSubject(account: LocalIdentityAccount): string {
  return "googleAccount" in account
    ? `google:${account.googleAccount.googleSubject}`
    : `apple:${account.appleAccount.appleSubject}`;
}
