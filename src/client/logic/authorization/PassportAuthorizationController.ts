import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import {
  LocalStorageIdentityRepository,
  type LocalIdentityErrorCode,
} from "../local-identity/LocalStorageIdentityRepository";
import type {
  PubkyIdentityKey,
  PubkyPublicIdentity,
} from "../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../pubky/PubkySdkAdapter";
import {
  expireAuthorizationEntry,
  readAndScrubAuthorizationEntry,
  type AuthorizationEntry,
} from "./authorizationEntry";
import { takeInitialAuthorizationEntry } from "./authorizationEntryBootstrap";
import {
  completeAuthorizationOutcome,
  type AuthorizationOutcome,
} from "./completeAuthorizationOutcome";
import {
  type AuthorizationRequestReview,
  IssuedPubkyAuthRequest,
} from "./IssuedPubkyAuthRequest";

/** Finite, render-safe states emitted by the authorization controller. */
export type PassportAuthorizationViewState =
  | { status: "manual-entry" }
  | { status: "invalid" }
  | { status: "review"; review: AuthorizationRequestReview }
  | { status: "approving"; review: AuthorizationRequestReview }
  | { status: "completing"; review: AuthorizationRequestReview }
  | { status: "approved" }
  | { status: "cancelled" }
  | { status: "failed" };

type LocalTerminalState = Extract<
  PassportAuthorizationViewState,
  { status: "approved" | "cancelled" | "failed" }
>;

type AuthorizationAction = Readonly<{
  request: IssuedPubkyAuthRequest;
  expiresAt: number;
}>;

/** Coordinates one reviewed request from browser entry to a terminal outcome. */
export class PassportAuthorizationController {
  private abortController = new AbortController();
  private disposed = false;
  private expirationTimer: number | undefined;
  private expiresAt: number | undefined;
  private listeners = new Set<(state: PassportAuthorizationViewState) => void>();
  private request: IssuedPubkyAuthRequest | undefined;
  private state: PassportAuthorizationViewState;

  constructor(
    private appWindow: Window = window,
    entry: AuthorizationEntry = readAuthorizationEntry(appWindow),
  ) {
    if (entry.status !== "valid") {
      this.state = { status: entry.status === "empty" ? "manual-entry" : "invalid" };
      return;
    }

    if (Date.now() >= entry.expiresAt) {
      expireAuthorizationEntry(entry);
      this.state = { status: "invalid" };
      return;
    }

    this.request = entry.request;
    this.expiresAt = entry.expiresAt;
    this.state = { status: "review", review: entry.request.review };
    this.scheduleExpiration();
  }

  getState(): PassportAuthorizationViewState {
    return this.state;
  }

  subscribe(listener: (state: PassportAuthorizationViewState) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Releases an abandoned review and suppresses completion of in-flight work. */
  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.abortController.abort();
    this.clearExpirationTimer();
    if (this.request) IssuedPubkyAuthRequest.release(this.request);
    this.request = undefined;
    this.expiresAt = undefined;
    this.listeners.clear();
  }

  async approve(publicKeyZ32: string): Promise<PassportAuthorizationViewState> {
    const action = this.beginAction();
    if (!action || this.state.status !== "review") return this.state;

    const review = this.state.review;
    this.update({ status: "approving", review });
    const result = await approveAuthorization(
      action.request,
      publicKeyZ32,
      action.expiresAt,
    );
    return this.completeRequestOutcome(
      action.request,
      Result.isOk(result) ? "success" : "error",
      review,
    );
  }

  async cancel(): Promise<PassportAuthorizationViewState> {
    const action = this.beginAction();
    if (!action || this.state.status !== "review") return this.state;

    return this.completeRequestOutcome(action.request, "cancel", this.state.review);
  }

  private beginAction(): AuthorizationAction | undefined {
    if (this.disposed || !this.request || this.state.status !== "review") return undefined;

    if (this.expiresAt === undefined || Date.now() >= this.expiresAt) {
      this.expire();
      return undefined;
    }

    this.clearExpirationTimer();
    return { request: this.request, expiresAt: this.expiresAt };
  }

  private async completeRequestOutcome(
    request: IssuedPubkyAuthRequest,
    outcome: AuthorizationOutcome,
    review: AuthorizationRequestReview,
  ): Promise<PassportAuthorizationViewState> {
    if (this.disposed) {
      IssuedPubkyAuthRequest.release(request);
      return this.state;
    }

    this.request = undefined;
    this.expiresAt = undefined;
    const callback = IssuedPubkyAuthRequest.takeOutcomeCallback(request, outcome);
    if (!callback) return this.update(localStateForOutcome(outcome));

    this.update({ status: "completing", review });
    let completed = false;
    try {
      completed = await completeAuthorizationOutcome(
        this.appWindow,
        callback,
        outcome,
        this.abortController.signal,
      );
    } catch {
      // Continue to the safe local outcome below.
    }
    if (completed) return this.state;

    LOGGER.warn("authorize.callback.failed", {
      outcome,
      operation: "complete",
    });
    return this.update(localStateForOutcome(outcome));
  }

  private scheduleExpiration(): void {
    if (this.expiresAt === undefined) return;
    const remainingLifetime = Math.max(0, this.expiresAt - Date.now());
    this.expirationTimer = this.appWindow.setTimeout(this.expire, remainingLifetime);
  }

  private expire = (): void => {
    if (!this.request || this.state.status !== "review" || this.expiresAt === undefined) {
      return;
    }

    if (Date.now() < this.expiresAt) {
      this.scheduleExpiration();
      return;
    }

    IssuedPubkyAuthRequest.release(this.request);
    this.request = undefined;
    this.expiresAt = undefined;
    this.clearExpirationTimer();
    this.update({ status: "invalid" });
  };

  private clearExpirationTimer(): void {
    if (this.expirationTimer !== undefined) {
      this.appWindow.clearTimeout(this.expirationTimer);
      this.expirationTimer = undefined;
    }
  }

  private update(state: PassportAuthorizationViewState): PassportAuthorizationViewState {
    this.state = state;
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        LOGGER.warn("authorize.state_listener.failed", { state: state.status });
      }
    }
    return state;
  }
}

function readAuthorizationEntry(appWindow: Window): AuthorizationEntry {
  const initialEntry = appWindow === window
    ? takeInitialAuthorizationEntry()
    : undefined;
  return initialEntry ?? readAndScrubAuthorizationEntry(appWindow);
}

function localStateForOutcome(outcome: AuthorizationOutcome): LocalTerminalState {
  switch (outcome) {
    case "success":
      return { status: "approved" };
    case "error":
      return { status: "failed" };
    case "cancel":
      return { status: "cancelled" };
  }
}

export type { AuthorizationRequestReview } from "./IssuedPubkyAuthRequest";

type ApproveAuthorizationResult = ResultType<
  void,
  { code: "approval_failed" }
>;

type RestoreLocalIdentityResult = ResultType<
  PubkyIdentityKey,
  { code: RestoreLocalIdentityErrorCode }
>;

type RestoreLocalIdentityErrorCode =
  | LocalIdentityErrorCode
  | "identity_mismatch"
  | "restore_failed";

/** Approves one request with the exact local identity selected during review. */
async function approveAuthorization(
  request: IssuedPubkyAuthRequest,
  publicKeyZ32: string,
  expiresAt: number,
): Promise<ApproveAuthorizationResult> {
  let pubky: PubkySdkAdapter;
  try {
    pubky = new PubkySdkAdapter();
  } catch {
    LOGGER.warn("authorize.approval.failed", {
      stage: "sdk_initialize",
      code: "unexpected_failure",
    });
    return Result.err({ code: "approval_failed" });
  }

  let keyHandle: PubkyIdentityKey["keyHandle"] | undefined;
  let stage: "identity_restore" | "sdk_approve" = "identity_restore";
  try {
    const restored = await restoreLocalIdentity(pubky, publicKeyZ32);
    if (Result.isError(restored)) return Result.err({ code: "approval_failed" });

    keyHandle = restored.value.keyHandle;
    if (Date.now() >= expiresAt) return Result.err({ code: "approval_failed" });

    stage = "sdk_approve";
    const approved = await pubky.approveAuthRequest(keyHandle, request);
    return Result.isError(approved)
      ? Result.err({ code: "approval_failed" })
      : Result.ok();
  } catch {
    LOGGER.warn("authorize.approval.failed", {
      stage,
      code: "unexpected_failure",
    });
    return Result.err({ code: "approval_failed" });
  } finally {
    disposeIdentityKey(pubky, keyHandle);
    disposePubky(pubky);
  }
}

/** Restores and verifies one named local identity, clearing plaintext key bytes. */
async function restoreLocalIdentity(
  pubky: PubkySdkAdapter,
  publicKeyZ32: string,
): Promise<RestoreLocalIdentityResult> {
  const stored = new LocalStorageIdentityRepository().read(publicKeyZ32);
  if (Result.isError(stored)) return Result.err(stored.error);

  try {
    if (stored.value.identity.publicIdentity.publicKeyZ32 !== publicKeyZ32) {
      LOGGER.warn("identity.local_restore.failed", { code: "identity_mismatch" });
      return Result.err({ code: "identity_mismatch" });
    }

    const restored = await pubky.restoreIdentityKey(stored.value.secretKey);
    if (Result.isError(restored)) return Result.err({ code: "restore_failed" });

    if (!isSamePublicIdentity(restored.value.publicIdentity, stored.value.identity.publicIdentity)) {
      disposeIdentityKey(pubky, restored.value.keyHandle);
      LOGGER.warn("identity.local_restore.failed", { code: "identity_mismatch" });
      return Result.err({ code: "identity_mismatch" });
    }

    return Result.ok(restored.value);
  } finally {
    stored.value.secretKey.bytes.fill(0);
  }
}

function disposeIdentityKey(
  pubky: PubkySdkAdapter,
  keyHandle: PubkyIdentityKey["keyHandle"] | undefined,
): void {
  if (!keyHandle) return;

  try {
    pubky.disposeIdentityKey(keyHandle);
  } catch {
    LOGGER.warn("authorize.cleanup.failed", { operation: "identity_key_dispose" });
  }
}

function disposePubky(pubky: PubkySdkAdapter): void {
  try {
    pubky.dispose();
  } catch {
    LOGGER.warn("authorize.cleanup.failed", { operation: "pubky_dispose" });
  }
}

function isSamePublicIdentity(left: PubkyPublicIdentity, right: PubkyPublicIdentity): boolean {
  return left.publicKeyZ32 === right.publicKeyZ32
    && left.publicKeyDisplay === right.publicKeyDisplay;
}
