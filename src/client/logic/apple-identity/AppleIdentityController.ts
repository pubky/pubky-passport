import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { AppleAccount } from "@/libs/appleAccount";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import type { IdentityProgress } from "@/client/logic/identity-lifecycle/PassportFileIdentityLifecycle";
import { ICloudPassportFileStore } from "@/client/logic/passport-file/icloud/ICloudPassportFileStore";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import type {
  AppleIdentityEstablishment,
  AppleIdentityLifecycle,
  AppleIdentityLifecycleError,
  ICloudStorePort,
} from "./AppleIdentityLifecycle";
import {
  ICloudConnection,
  type CloudKitDatabase,
  type ICloudConfiguration,
  type ICloudConnectionError,
} from "./ICloudConnection";
import {
  SignInWithApple,
  type AppleIdentityCredentials,
  type SignInWithAppleError,
} from "./SignInWithApple";

export type AppleIdentityConfiguration = Readonly<{
  servicesId: string;
  homegateBaseUrl: string;
  icloud: ICloudConfiguration;
}>;

type AppleIdentityError =
  | AppleIdentityLifecycleError
  | SignInWithAppleError
  | ICloudConnectionError
  | CodedFailure<"apple_session_expired" | "cancelled" | "operation_failed">;

/** Error fields allowed to cross into React state or rendered output. */
export type AppleIdentityViewError = {
  code: AppleIdentityError["code"];
  detailCode?: Extract<AppleIdentityError, { detailCode: string }>["detailCode"];
};

export type EstablishedAppleIdentity = Readonly<{
  establishmentMode: "created" | "restored";
  appleAccount: AppleAccount;
  publicIdentity: PubkyPublicIdentity;
}>;

/** Render-safe states of the two-step Apple flow. No token ever enters these states. */
export type AppleIdentityViewState =
  | { status: "idle" }
  | { status: "requesting-apple" }
  | {
      status: "connect-icloud";
      ready: boolean;
      notice?: ICloudConnectionError["code"] | undefined;
    }
  | { status: "connecting-icloud" }
  | { status: "establishing"; progress: IdentityProgress }
  | { status: "established"; identity: EstablishedAppleIdentity }
  | { status: "detaching" }
  | { status: "detached" }
  | {
      status: "failed";
      error: AppleIdentityViewError;
      /** The Apple Account's email, shown when the failure is about which account was used. */
      appleEmail?: string | undefined;
    };

type Operation =
  | { kind: "establish" | "replace_invalid_passport_file" | "replace_undecryptable_passport_file" }
  | { kind: "detach"; publicIdentity: PubkyPublicIdentity; expectedAppleSubject: string };

type Connection = Pick<ICloudConnection, "prepare" | "connect" | "dispose"> &
  Partial<Pick<ICloudConnection, "focusPopup" | "cancel">>;

type Lifecycle = Pick<
  AppleIdentityLifecycle,
  | "establishIdentity"
  | "replaceInvalidPassportFile"
  | "replaceUndecryptablePassportFile"
  | "detachIdentity"
  | "abortRequests"
  | "dispose"
>;

export type AppleIdentityControllerDependencies = {
  signInWithApple?: Pick<SignInWithApple, "signIn"> &
    Partial<Pick<SignInWithApple, "focusPopup" | "cancel">>;
  createICloudConnection?: () => Connection;
  createLifecycle?: (homegateBaseUrl: string, passportOrigin: string) => Lifecycle;
  createStore?: (
    database: CloudKitDatabase,
    appleSubject: string,
    passportOrigin: string,
  ) => ICloudStorePort;
};

const IDLE_STATE: AppleIdentityViewState = { status: "idle" };
/** Failures about which Apple Account was used; their screen names the signed-in account. */
const ACCOUNT_FAILURES: ReadonlySet<AppleIdentityError["code"]> = new Set([
  "apple_account_mismatch",
  "icloud_account_mismatch",
  "icloud_record_missing",
]);
const CREDENTIAL_EXPIRY_MARGIN_MS = 30_000;

/**
 * Presentation-facing controller for one screen's Apple flow:
 *
 * 1. {@link continueWithApple}: Sign in with Apple popup. Yields an Apple ID token that only the
 *    Passport server sees (to derive the wrapping key) and Homegate (for a signup invitation).
 * 2. {@link connectICloud}: CloudKit sign-in popup. Yields a CloudKit session that stays in this
 *    page's memory and only talks to Apple, then reads, creates or deletes the encrypted record.
 *
 * The first click opens one window. A validated Apple reply hands it to iCloud synchronously.
 * If that window cannot be reused, the user can continue from the second-step screen.
 */
export class AppleIdentityController {
  private readonly signInWithApple: Pick<SignInWithApple, "signIn"> &
    Partial<Pick<SignInWithApple, "focusPopup" | "cancel">>;
  private connection: Connection | undefined;
  private handoff: ReturnType<ICloudConnection["connect"]> | undefined;
  private lifecycle: Lifecycle | undefined;
  private credentials: AppleIdentityCredentials | undefined;
  private readonly namesBySubject = new Map<string, string>();
  private database: CloudKitDatabase | undefined;
  private operation: Operation = { kind: "establish" };
  private busy = false;
  private disposed = false;
  private state: AppleIdentityViewState = IDLE_STATE;
  private readonly listeners = new Set<(state: AppleIdentityViewState) => void>();

  constructor(
    private readonly configuration: AppleIdentityConfiguration,
    private readonly dependencies: AppleIdentityControllerDependencies = {},
  ) {
    this.signInWithApple =
      dependencies.signInWithApple ??
      new SignInWithApple(configuration.servicesId, `${globalThis.location.origin}/`);
    this.prewarmICloud();
  }

  getState(): AppleIdentityViewState {
    return this.state;
  }

  subscribe(listener: (state: AppleIdentityViewState) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Step 1 for a new or returning user. Opens the Apple popup synchronously. */
  continueWithApple(): Promise<ResultType<void, AppleIdentityViewError>> {
    return this.startWithApple({ kind: "establish" });
  }

  /** Step 1 of detaching: the Apple Account must be the one the identity was saved with. */
  detachIdentity(
    publicIdentity: PubkyPublicIdentity,
    expectedAppleSubject: string,
  ): Promise<ResultType<void, AppleIdentityViewError>> {
    return this.startWithApple({ kind: "detach", publicIdentity, expectedAppleSubject });
  }

  /** Deletes a damaged iCloud record and creates a new identity; reuses a live session. */
  replaceInvalidPassportFile(): Promise<ResultType<void, AppleIdentityViewError>> {
    return this.rerun({ kind: "replace_invalid_passport_file" });
  }

  /** Deletes a record this Apple Account cannot decrypt and creates a new identity. */
  replaceUndecryptablePassportFile(): Promise<ResultType<void, AppleIdentityViewError>> {
    return this.rerun({ kind: "replace_undecryptable_passport_file" });
  }

  /** Step 2. Opens the iCloud popup synchronously, then runs the pending operation. */
  connectICloud(): Promise<ResultType<void, AppleIdentityViewError>> {
    const connection = this.connection;
    if (this.busy || this.state.status !== "connect-icloud" || !this.state.ready || !connection) {
      return Promise.resolve(Result.err({ code: "operation_failed" }));
    }
    if (!this.hasFreshCredentials()) return this.startWithApple(this.operation);
    this.busy = true;
    const connected = connection.connect();
    this.publish({ status: "connecting-icloud" });
    return this.finishConnect(connected);
  }

  focusSignIn(): void {
    this.signInWithApple.focusPopup?.();
  }

  cancelSignIn(): void {
    this.signInWithApple.cancel?.();
  }

  focusICloud(): void {
    this.connection?.focusPopup?.();
  }

  cancelICloud(): void {
    this.connection?.cancel?.();
  }

  private prewarmICloud(): void {
    if (this.disposed) return;
    const connection =
      this.connection ??
      this.dependencies.createICloudConnection?.() ??
      new ICloudConnection(this.configuration.icloud);
    this.connection = connection;
    void connection.prepare();
  }

  /** Returns to idle so a new attempt can use a different Apple Account. */
  reset(): void {
    if (this.busy || this.disposed) return;
    this.credentials = undefined;
    this.database = undefined;
    this.connection?.dispose();
    this.connection = undefined;
    this.publish(IDLE_STATE);
    this.prewarmICloud();
  }

  /** Drops the Apple token and CloudKit session and releases Pubky resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.signInWithApple.cancel?.();
    this.listeners.clear();
    this.credentials = undefined;
    this.database = undefined;
    try {
      this.connection?.dispose();
    } catch (e) {
      LOGGER.warn("identity.apple.cleanup.failed", {
        operation: "icloud_dispose",
        ...safeErrorLogFields(e),
      });
    }
    this.connection = undefined;
    this.lifecycle?.abortRequests();
    if (!this.busy) this.disposeLifecycle();
  }

  private startWithApple(operation: Operation): Promise<ResultType<void, AppleIdentityViewError>> {
    if (this.busy || this.disposed) {
      return Promise.resolve(
        Result.err({ code: this.disposed ? "cancelled" : "operation_failed" }),
      );
    }
    this.busy = true;
    this.operation = operation;
    this.credentials = undefined;
    if (this.database) {
      this.connection?.dispose();
      this.connection = undefined;
    }
    this.database = undefined;
    this.prewarmICloud();
    this.handoff = undefined;
    const signedIn = this.signInWithApple.signIn((popup, credentials) => {
      if (
        this.disposed ||
        !this.connection ||
        popup.closed ||
        credentials.expiresAt <= Date.now() + CREDENTIAL_EXPIRY_MARGIN_MS
      )
        return false;
      if (
        operation.kind === "detach" &&
        credentials.appleSubject !== operation.expectedAppleSubject
      )
        return false;
      this.credentials = this.rememberName(credentials);
      this.handoff = this.connection.connect(popup);
      this.publish({ status: "connecting-icloud" });
      return true;
    });
    this.publish({ status: "requesting-apple" });
    return this.finishAppleSignIn(signedIn);
  }

  private async finishAppleSignIn(
    signedIn: ReturnType<SignInWithApple["signIn"]>,
  ): Promise<ResultType<void, AppleIdentityViewError>> {
    try {
      const credentials = await signedIn;
      if (this.disposed) return Result.err({ code: "cancelled" });
      if (Result.isError(credentials)) return this.fail(credentials.error);
      const operation = this.operation;
      if (
        operation.kind === "detach" &&
        credentials.value.appleSubject !== operation.expectedAppleSubject
      ) {
        LOGGER.warn("identity.apple.authorization.failed", { code: "account_mismatch" });
        return this.fail({ code: "apple_account_mismatch" }, credentials.value.email);
      }
      this.credentials = this.rememberName(credentials.value);
      if (!this.hasFreshCredentials()) {
        if (this.handoff) {
          const connection = this.connection;
          this.handoff = undefined;
          this.connection = undefined;
          connection?.dispose();
        }
        return this.fail({ code: "apple_session_expired" });
      }
      if (this.handoff) return await this.finishConnect(this.handoff);
      return await this.prepareICloud();
    } catch (e) {
      return this.unexpected("sign_in_with_apple", e);
    } finally {
      this.endOperation();
    }
  }

  private async prepareICloud(
    notice?: ICloudConnectionError["code"],
  ): Promise<ResultType<void, AppleIdentityViewError>> {
    // Re-arming after a closed or blocked iCloud window reuses the same CloudKit container, so
    // no second CloudKit instance is left listening for a session.
    const connection =
      this.connection ??
      this.dependencies.createICloudConnection?.() ??
      new ICloudConnection(this.configuration.icloud);
    this.connection = connection;
    this.publish({ status: "connect-icloud", ready: false, notice });
    const prepared = await connection.prepare();
    if (this.disposed || this.connection !== connection) return Result.err({ code: "cancelled" });
    this.publish({
      status: "connect-icloud",
      ready: true,
      notice: Result.isError(prepared) ? prepared.error.code : notice,
    });
    return Result.ok();
  }

  private async finishConnect(
    connected: ReturnType<ICloudConnection["connect"]>,
  ): Promise<ResultType<void, AppleIdentityViewError>> {
    try {
      const database = await connected;
      if (this.disposed) return Result.err({ code: "cancelled" });
      if (Result.isError(database)) {
        const { code } = database.error;
        return await this.prepareICloud(code);
      }
      this.database = database.value;
      return await this.runOperation();
    } catch (e) {
      return this.unexpected("connect_icloud", e);
    } finally {
      this.endOperation();
    }
  }

  private async rerun(operation: Operation): Promise<ResultType<void, AppleIdentityViewError>> {
    if (this.busy || this.disposed) {
      return Result.err({ code: this.disposed ? "cancelled" : "operation_failed" });
    }
    if (!this.database || !this.hasFreshCredentials()) return this.startWithApple(operation);
    this.busy = true;
    this.operation = operation;
    try {
      return await this.runOperation();
    } catch (e) {
      return this.unexpected("rerun", e);
    } finally {
      this.endOperation();
    }
  }

  private async runOperation(): Promise<ResultType<void, AppleIdentityViewError>> {
    const credentials = this.credentials;
    const database = this.database;
    if (!credentials || !database) return this.fail({ code: "operation_failed" });
    if (!this.hasFreshCredentials()) return this.fail({ code: "apple_session_expired" });

    const operation = this.operation;
    this.publish(
      operation.kind === "detach"
        ? { status: "detaching" }
        : { status: "establishing", progress: { flow: "lookup", step: "checking" } },
    );
    const lifecycle = await this.ensureLifecycle();
    if (this.disposed) return Result.err({ code: "cancelled" });
    const origin = globalThis.location.origin;
    const store =
      this.dependencies.createStore?.(database, credentials.appleSubject, origin) ??
      new ICloudPassportFileStore(database, credentials.appleSubject, origin);

    if (operation.kind === "detach") {
      const detached = await lifecycle.detachIdentity(
        credentials,
        store,
        operation.publicIdentity,
        operation.expectedAppleSubject,
      );
      if (this.disposed) return Result.err({ code: "cancelled" });
      if (Result.isError(detached)) return this.fail(detached.error);
      this.publish({ status: "detached" });
      return Result.ok();
    }

    let reporting = true;
    const report = (progress: IdentityProgress) => {
      if (reporting) this.publish({ status: "establishing", progress });
    };
    const established = await this.establish(lifecycle, operation.kind, credentials, store, report);
    reporting = false;
    if (this.disposed) return Result.err({ code: "cancelled" });
    if (Result.isError(established)) return this.fail(established.error);
    this.publish({
      status: "established",
      identity: Object.freeze({
        establishmentMode: established.value.establishmentMode,
        appleAccount: established.value.appleAccount,
        publicIdentity: established.value.publicIdentity,
      }),
    });
    return Result.ok();
  }

  private establish(
    lifecycle: Lifecycle,
    kind: "establish" | "replace_invalid_passport_file" | "replace_undecryptable_passport_file",
    credentials: AppleIdentityCredentials,
    store: ICloudStorePort,
    report: (progress: IdentityProgress) => void,
  ): Promise<ResultType<AppleIdentityEstablishment, AppleIdentityLifecycleError>> {
    switch (kind) {
      case "establish":
        return lifecycle.establishIdentity(credentials, store, report);
      case "replace_invalid_passport_file":
        return lifecycle.replaceInvalidPassportFile(credentials, store, report);
      case "replace_undecryptable_passport_file":
        return lifecycle.replaceUndecryptablePassportFile(credentials, store, report);
    }
  }

  /**
   * Apple sends the name once. Keep it in memory for this page, so a retry after a failed first
   * attempt still saves it with the identity.
   */
  private rememberName(credentials: AppleIdentityCredentials): AppleIdentityCredentials {
    if (credentials.name !== null) {
      this.namesBySubject.set(credentials.appleSubject, credentials.name);
      return credentials;
    }
    const name = this.namesBySubject.get(credentials.appleSubject);
    return name === undefined ? credentials : Object.freeze({ ...credentials, name });
  }

  private hasFreshCredentials(): boolean {
    return (
      this.credentials !== undefined &&
      this.credentials.expiresAt > Date.now() + CREDENTIAL_EXPIRY_MARGIN_MS
    );
  }

  private async ensureLifecycle(): Promise<Lifecycle> {
    if (this.lifecycle) return this.lifecycle;
    let create = this.dependencies.createLifecycle;
    if (!create) {
      const { AppleIdentityLifecycle } = await import("./AppleIdentityLifecycle");
      create = (homegateBaseUrl, passportOrigin) =>
        new AppleIdentityLifecycle(homegateBaseUrl, passportOrigin);
    }
    this.lifecycle = create(this.configuration.homegateBaseUrl, globalThis.location.origin);
    if (this.disposed) this.disposeLifecycle();
    return this.lifecycle;
  }

  private fail(
    error: AppleIdentityError,
    signedInEmail: string | null | undefined = this.credentials?.email,
  ): ResultType<never, AppleIdentityViewError> {
    const viewError: AppleIdentityViewError =
      "detailCode" in error
        ? { code: error.code, detailCode: error.detailCode }
        : { code: error.code };
    if (error.code !== "cancelled") {
      LOGGER.warn("identity.apple.action.failed", {
        operation: this.operation.kind,
        code: error.code,
        ...safeErrorLogFields(error),
      });
    }
    const appleEmail = ACCOUNT_FAILURES.has(error.code) ? signedInEmail : undefined;
    this.publish({ status: "failed", error: viewError, ...(appleEmail ? { appleEmail } : {}) });
    return Result.err(viewError);
  }

  private unexpected(stage: string, e: unknown): ResultType<never, AppleIdentityViewError> {
    if (this.disposed) return Result.err({ code: "cancelled" });
    LOGGER.warn("identity.apple.action.failed", {
      stage,
      code: "unexpected_failure",
      ...safeErrorLogFields(e),
    });
    return this.fail({ code: "operation_failed" });
  }

  /** Releases the busy flag; a lifecycle disposed mid-operation is released once it settles. */
  private endOperation(): void {
    this.busy = false;
    if (this.disposed) this.disposeLifecycle();
  }

  private disposeLifecycle(): void {
    try {
      this.lifecycle?.dispose();
    } catch (e) {
      LOGGER.warn("identity.apple.cleanup.failed", {
        operation: "pubky_dispose",
        ...safeErrorLogFields(e),
      });
    }
  }

  private publish(state: AppleIdentityViewState): void {
    if (this.disposed) return;
    this.state = state;
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (e) {
        LOGGER.warn("identity.apple.state_listener.failed", {
          state: state.status,
          ...safeErrorLogFields(e),
        });
      }
    }
  }
}
