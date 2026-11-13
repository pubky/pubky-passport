import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { AppleAccount } from "@/libs/appleAccount";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import {
  HomegateClient,
  type HomeserverSignupDetails,
} from "@/client/logic/homegate/HomegateClient";
import {
  PassportFileIdentityLifecycle,
  type IdentityAttachment,
  type IdentityLifecycleError,
  type IdentityProgress,
  type PassportFileIdentityLifecycleDependencies,
  type StepResult,
} from "@/client/logic/identity-lifecycle/PassportFileIdentityLifecycle";
import type {
  ICloudRecordReference,
  ICloudStoreFailure,
} from "@/client/logic/passport-file/icloud/ICloudPassportFileStore";
import { LocalStorageIdentityRepository } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { PassportFileStore } from "@/client/logic/passport-file/passportFileStore";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import type { AppleIdentityCredentials } from "./SignInWithApple";

export type ICloudStorePort = PassportFileStore<ICloudRecordReference, ICloudStoreFailure>;

/** Failure produced by the Apple lifecycle, before the controller strips diagnostics. */
export type AppleIdentityLifecycleError =
  | IdentityLifecycleError
  | ({ code: "icloud_read_failed" | "icloud_write_failed" | "icloud_cleanup_failed" } & {
      detailCode: ICloudStoreFailure["code"];
      cause?: unknown;
    })
  | CodedFailure<
      | "icloud_account_mismatch"
      | "icloud_other_origin"
      | "icloud_record_missing"
      | "icloud_create_conflict"
      | "icloud_quota_exceeded"
      | "invalid_passport_file"
      | "invalid_passport_file_delete_failed"
      | "undecryptable_passport_file_delete_failed"
      | "apple_account_mismatch"
      | "local_remove_failed"
    >;

export type AppleIdentityEstablishment = Readonly<{
  establishmentMode: "created" | "restored";
  appleAccount: AppleAccount;
  publicIdentity: PubkyPublicIdentity;
}>;

type EstablishmentResult = ResultType<AppleIdentityEstablishment, AppleIdentityLifecycleError>;

export type AppleIdentityLifecycleDependencies = PassportFileIdentityLifecycleDependencies & {
  homegate?: Pick<HomegateClient, "requestAppleSignupToken">;
  /** Identities already in this browser; one may hold the name Apple sent only once. */
  localIdentities?: Pick<LocalStorageIdentityRepository, "list">;
};

/**
 * Creates, restores, repairs and detaches identities whose encrypted Passport file lives in the
 * user's iCloud private database. The controller supplies a checked Apple ID token and a store
 * bound to the connected iCloud account; this class never sees the CloudKit session.
 *
 * Public asynchronous operations settle with a Result and do not intentionally reject.
 */
export class AppleIdentityLifecycle extends PassportFileIdentityLifecycle {
  private readonly homegate: NonNullable<AppleIdentityLifecycleDependencies["homegate"]>;
  private readonly localIdentities: NonNullable<
    AppleIdentityLifecycleDependencies["localIdentities"]
  >;

  /** @throws {Error} when a required dependency or configured endpoint cannot be initialized. */
  constructor(
    homegateBaseUrl: string,
    passportOrigin: string,
    dependencies: AppleIdentityLifecycleDependencies = {},
  ) {
    super("apple", passportOrigin, dependencies);
    try {
      this.homegate = dependencies.homegate ?? new HomegateClient(homegateBaseUrl, this.fetch);
      this.localIdentities = dependencies.localIdentities ?? new LocalStorageIdentityRepository();
    } catch (e) {
      this.releaseOwnedPubkyAfterConstructionFailure();
      throw e;
    }
  }

  /** Restores the iCloud identity when present, otherwise creates and activates one. */
  establishIdentity(
    credentials: AppleIdentityCredentials,
    store: ICloudStorePort,
    report: (progress: IdentityProgress) => void,
  ): Promise<EstablishmentResult> {
    return this.restoreOrCreate(credentials, store, report, false);
  }

  /**
   * Deletes the record only when this attempt confirms it still cannot be decrypted for this
   * Apple Account, then creates a replacement identity. A record that decrypts is restored.
   */
  replaceUndecryptablePassportFile(
    credentials: AppleIdentityCredentials,
    store: ICloudStorePort,
    report: (progress: IdentityProgress) => void,
  ): Promise<EstablishmentResult> {
    return this.restoreOrCreate(credentials, store, report, true);
  }

  /** Deletes a confirmed malformed record, then creates or restores current state. */
  async replaceInvalidPassportFile(
    credentials: AppleIdentityCredentials,
    store: ICloudStorePort,
    report: (progress: IdentityProgress) => void,
  ): Promise<EstablishmentResult> {
    try {
      const deleted = await store.deleteInvalidPassportFile();
      if (Result.isError(deleted)) {
        return Result.err({ code: "invalid_passport_file_delete_failed", cause: deleted.error });
      }
      return await this.establishIdentity(credentials, store, report);
    } catch (e) {
      LOGGER.warn("identity.apple.invalid_passport_file_replacement.failed", {
        code: "unexpected_failure",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "invalid_passport_file_delete_failed", cause: e });
    }
  }

  /**
   * Deletes the iCloud record after confirming it decrypts to this identity, then removes the
   * local identity. Any iCloud failure keeps the local copy.
   */
  async detachIdentity(
    credentials: AppleIdentityCredentials,
    store: ICloudStorePort,
    publicIdentity: PubkyPublicIdentity,
    expectedAppleSubject: string,
  ): Promise<ResultType<void, AppleIdentityLifecycleError>> {
    if (credentials.appleSubject !== expectedAppleSubject) {
      LOGGER.warn("identity.apple.detach.failed", {
        stage: "account_binding",
        code: "apple_account_mismatch",
      });
      return Result.err({ code: "apple_account_mismatch" });
    }
    try {
      const deleted = await this.deleteVerifiedRecord(credentials, store, publicIdentity);
      if (Result.isError(deleted)) return Result.err(deleted.error);
      const removed = this.repository.remove(publicIdentity.publicKeyZ32);
      return Result.isError(removed)
        ? Result.err({ code: "local_remove_failed", cause: removed.error })
        : Result.ok();
    } catch (e) {
      LOGGER.warn("identity.apple.detach.failed", {
        code: "unexpected_failure",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "unexpected_failure", cause: e });
    }
  }

  /**
   * Stores this browser's identity in the connected iCloud like a new setup does, then links the
   * Apple Account locally. A record holding another pubky stops the attach and nothing is
   * written or deleted.
   */
  async attachIdentity(
    credentials: AppleIdentityCredentials,
    store: ICloudStorePort,
    publicIdentity: PubkyPublicIdentity,
  ): Promise<
    ResultType<
      { attachment: IdentityAttachment; appleAccount: AppleAccount },
      AppleIdentityLifecycleError
    >
  > {
    const appleAccount = this.appleAccount(credentials);
    try {
      const attached = await this.attachToPassportFile({
        account: { appleAccount },
        publicIdentity,
        idToken: credentials.appleIdToken,
        store,
        readFailure,
        writeFailure,
      });
      if (Result.isError(attached)) return Result.err(attached.error);
      return Result.ok({ attachment: attached.value, appleAccount });
    } catch (e) {
      LOGGER.warn("identity.apple.attach.failed", {
        code: "unexpected_failure",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "unexpected_failure", cause: e });
    }
  }

  private async restoreOrCreate(
    credentials: AppleIdentityCredentials,
    store: ICloudStorePort,
    report: (progress: IdentityProgress) => void,
    replaceUndecryptableFile: boolean,
  ): Promise<EstablishmentResult> {
    const appleAccount = this.appleAccount(credentials);
    const account = { appleAccount };
    try {
      report({ flow: "lookup", step: "checking" });
      const storedFile = await store.readPassportFile();
      if (Result.isError(storedFile)) return Result.err(readFailure(storedFile.error));

      if (storedFile.value.status === "found") {
        const wrappingKey = await this.requestWrappingKey(
          credentials.appleIdToken,
          storedFile.value.envelope,
        );
        if (Result.isError(wrappingKey)) return Result.err(wrappingKey.error);
        const restored = await this.restoreIdentity({
          account,
          envelope: storedFile.value.envelope,
          wrappingKey: wrappingKey.value.wrappingKey,
          report,
          requestSignupToken: () => this.requestSignupToken(credentials.appleIdToken),
        });
        const undecryptable = Result.isError(restored) && restored.error.code === "decrypt_failed";
        if (!replaceUndecryptableFile || !undecryptable) {
          return Result.isError(restored)
            ? Result.err(restored.error)
            : Result.ok({
                establishmentMode: "restored",
                appleAccount,
                publicIdentity: restored.value.publicIdentity,
              });
        }

        LOGGER.info("identity.apple.undecryptable_passport_file_delete.started");
        const deleted = await store.deletePassportFile(storedFile.value.reference);
        if (Result.isError(deleted)) {
          return Result.err({
            code: "undecryptable_passport_file_delete_failed",
            cause: deleted.error,
          });
        }
      }

      report({ flow: "create", step: "preparing" });
      const wrappingKey = await this.requestWrappingKey(credentials.appleIdToken);
      if (Result.isError(wrappingKey)) return Result.err(wrappingKey.error);
      const signupDetails = await this.requestSignupToken(credentials.appleIdToken);
      if (Result.isError(signupDetails)) return Result.err(signupDetails.error);

      report({ flow: "create", step: "creating" });
      const created = await this.createIdentity({
        account,
        signupDetails: signupDetails.value,
        wrappingKey: wrappingKey.value.wrappingKey,
        keyId: wrappingKey.value.keyId,
        report,
        persist: async (envelope): Promise<StepResult<void, AppleIdentityLifecycleError>> => {
          LOGGER.info("identity.apple.icloud_write.started");
          const written = await store.createPassportFile(envelope);
          if (Result.isError(written)) return Result.err(writeFailure(written.error));
          LOGGER.info("identity.apple.icloud_write.completed");
          return Result.ok();
        },
      });
      if (Result.isError(created)) return Result.err(created.error);
      LOGGER.info("identity.apple.create.completed");
      return Result.ok({
        establishmentMode: "created",
        appleAccount,
        publicIdentity: created.value.publicIdentity,
      });
    } catch (e) {
      LOGGER.warn("identity.apple.restore_or_create.failed", {
        code: "unexpected_failure",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "unexpected_failure", cause: e });
    }
  }

  /**
   * The account saved with the identity. Without a name in this sign-in, a name this browser
   * already keeps for the same Apple subject is reused; nothing else is looked up.
   */
  private appleAccount(credentials: AppleIdentityCredentials): AppleAccount {
    return Object.freeze({
      appleSubject: credentials.appleSubject,
      email: credentials.email,
      name: credentials.name ?? this.storedName(credentials.appleSubject),
    });
  }

  private storedName(appleSubject: string): string | null {
    try {
      const catalog = this.localIdentities.list();
      if (Result.isError(catalog)) return null;
      const stored = catalog.value.identities.find(
        (identity) => identity.appleAccount?.appleSubject === appleSubject,
      );
      return stored?.appleAccount?.name ?? null;
    } catch {
      return null;
    }
  }

  private async deleteVerifiedRecord(
    credentials: AppleIdentityCredentials,
    store: ICloudStorePort,
    publicIdentity: PubkyPublicIdentity,
  ): Promise<ResultType<void, AppleIdentityLifecycleError>> {
    const storedFile = await store.readPassportFile();
    if (Result.isError(storedFile)) {
      return Result.err({
        code: "icloud_cleanup_failed",
        detailCode: storedFile.error.code,
        cause: storedFile.error,
      });
    }
    // Nothing ties the connected iCloud account to the Apple sign-in. An empty iCloud may be
    // another account than the one holding this identity's record, so it confirms nothing.
    if (storedFile.value.status === "missing") return Result.err({ code: "icloud_record_missing" });

    const wrappingKey = await this.requestWrappingKey(
      credentials.appleIdToken,
      storedFile.value.envelope,
    );
    if (Result.isError(wrappingKey)) return Result.err(wrappingKey.error);
    const restored = await this.restoreKey(
      storedFile.value.envelope,
      wrappingKey.value.wrappingKey,
    );
    if (Result.isError(restored)) return Result.err(restored.error);
    try {
      if (restored.value.publicIdentity.publicKeyZ32 !== publicIdentity.publicKeyZ32) {
        LOGGER.warn("identity.apple.delete.failed", {
          stage: "identity_validation",
          code: "identity_mismatch",
        });
        return Result.err({ code: "identity_mismatch" });
      }
    } finally {
      this.disposeIdentityKey(restored.value, "deleted_key_dispose");
    }

    const deleted = await store.deletePassportFile(storedFile.value.reference);
    return Result.isError(deleted)
      ? Result.err({
          code: "icloud_cleanup_failed",
          detailCode: deleted.error.code,
          cause: deleted.error,
        })
      : Result.ok();
  }

  private async requestSignupToken(
    appleIdToken: string,
  ): Promise<StepResult<HomeserverSignupDetails>> {
    LOGGER.info("identity.apple.homeserver_signup_token.started");
    const signupDetails = await this.homegate.requestAppleSignupToken(appleIdToken);
    if (Result.isError(signupDetails)) {
      return Result.err({
        code: "homeserver_signup_token_failed",
        detailCode: signupDetails.error.code,
        cause: signupDetails.error,
      });
    }
    LOGGER.info("identity.apple.homeserver_signup_token.completed");
    return Result.ok(signupDetails.value);
  }
}

function readFailure(error: ICloudStoreFailure): AppleIdentityLifecycleError {
  switch (error.code) {
    case "invalid_file":
      return { code: "invalid_passport_file", cause: error };
    case "account_mismatch":
      return { code: "icloud_account_mismatch", cause: error };
    case "other_origin":
      return { code: "icloud_other_origin", cause: error };
    default:
      return { code: "icloud_read_failed", detailCode: error.code, cause: error };
  }
}

function writeFailure(error: ICloudStoreFailure): AppleIdentityLifecycleError {
  switch (error.code) {
    case "create_conflict":
      return { code: "icloud_create_conflict", cause: error };
    case "quota_exceeded":
      return { code: "icloud_quota_exceeded", cause: error };
    default:
      return { code: "icloud_write_failed", detailCode: error.code, cause: error };
  }
}
