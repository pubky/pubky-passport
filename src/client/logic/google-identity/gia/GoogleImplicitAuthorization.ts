import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { GoogleAccountProfile } from "../../../../libs/googleAccountProfile";
import { encodeBase64Url } from "../../../../libs/encoding/base64Url";
import { LOGGER, safeErrorLogFields } from "../../../../libs/logger/logger";
import { AUTHORIZATION_TIMEOUT_MS } from "../../../../libs/passportPolicy";
import type { CodedFailure } from "../../../../libs/result";
import { GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE } from "../../../../libs/authorization/earlyGoogleImplicitResponse";
import {
  GOOGLE_AUTHORIZATION_SCOPE,
  parseGoogleAuthorizationResponse,
} from "./parseGoogleAuthorizationResponse";
import { fetchGoogleAccountProfile } from "./fetchGoogleAccountProfile";
import { AuthorizationPopup } from "./AuthorizationPopup";

/** Short-lived credentials produced by one complete Google authorization. */
export type GoogleIdentityCredentials = {
  googleIdToken: string;
  driveAccessToken: string;
  googleAccount: GoogleAccountProfile;
};

type GoogleImplicitAuthorizationErrorCode =
  | "google_authorization_denied"
  | "google_authorization_failed"
  | "google_authorization_popup_closed"
  | "google_authorization_popup_failed_to_open";
type GoogleAuthorizationFailureReason =
  "authorization_disposed" | "authorization_in_progress" | "authorization_timed_out";
type GoogleAuthorizationFailure = CodedFailure<"google_authorization_failed"> & {
  /** Safe state-only context for generic authorization failures without a thrown cause. */
  reason?: GoogleAuthorizationFailureReason;
};
export type GoogleImplicitAuthorizationError =
  | GoogleAuthorizationFailure
  | CodedFailure<Exclude<GoogleImplicitAuthorizationErrorCode, "google_authorization_failed">>;
export type GoogleImplicitAuthorizationResult<Success> = ResultType<
  Success,
  GoogleImplicitAuthorizationError
>;

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const POPUP_POLL_MS = 200;

type AuthorizationAttempt = {
  nonce: string;
  abortController: AbortController;
  messageListener(event: MessageEvent): void;
  popup: AuthorizationPopup;
  poll?: ReturnType<typeof setInterval>;
  responseReceived: boolean;
  resolve(result: GoogleImplicitAuthorizationResult<GoogleIdentityCredentials>): void;
  state: string;
  timeout?: ReturnType<typeof setTimeout>;
};

type AuthorizationAttemptSetup = {
  abortController: AbortController;
  nonce: string;
  origin: string;
  popup: AuthorizationPopup;
  state: string;
};

/**
 * Coordinates Passport's browser-based Google OAuth 2.0 implicit authorization flow.
 *
 * In this flow Google returns an ID token and access token directly in the redirect fragment,
 * without a separate authorization-code exchange. Each request opens a Google consent popup,
 * validates the same-origin relayed fragment against its state and nonce, and binds the returned
 * credentials to Google UserInfo. Only one authorization attempt may be active at a time.
 *
 * Call {@link dispose} to settle an active request and release its popup, listeners, timers, and
 * in-flight profile request.
 */
export class GoogleImplicitAuthorization {
  private activeAttempt: AuthorizationAttempt | null = null;

  constructor(private readonly clientId: string) {}

  /**
   * Runs one Google authorization attempt.
   *
   * The promise settles with a Result for setup, popup, provider-response, and UserInfo
   * failures. It does not intentionally reject. Passing a login hint asks Google to select that
   * account but does not replace the ID-token and UserInfo account-binding checks.
   */
  request(
    loginHint?: string,
  ): Promise<GoogleImplicitAuthorizationResult<GoogleIdentityCredentials>> {
    if (this.activeAttempt) {
      LOGGER.warn("identity.google.implicit_authorization.failed", {
        operation: "authorize",
        stage: "request",
        code: "google_authorization_failed",
        reason: "authorization_in_progress",
      });
      return Promise.resolve(
        Result.err({
          code: "google_authorization_failed",
          reason: "authorization_in_progress",
        }),
      );
    }
    let popup: AuthorizationPopup | null = null;
    try {
      const origin = globalThis.location.origin;
      const state = randomBase64Url(32);
      const nonce = randomBase64Url(32);
      const abortController = new AbortController();
      const url = new URL(GOOGLE_AUTHORIZE_URL);
      url.search = new URLSearchParams({
        client_id: this.clientId,
        response_type: "id_token token",
        scope: GOOGLE_AUTHORIZATION_SCOPE,
        redirect_uri: origin,
        nonce,
        state,
        prompt: "consent",
        include_granted_scopes: "false",
        ...(loginHint ? { login_hint: loginHint } : {}),
      }).toString();

      popup = AuthorizationPopup.open(url, `pubky-passport-google-${state}`);
      if (!popup) {
        LOGGER.warn("identity.google.implicit_authorization.failed", {
          operation: "authorize",
          stage: "popup",
          code: "google_authorization_popup_failed_to_open",
        });
        return Promise.resolve(Result.err({ code: "google_authorization_popup_failed_to_open" }));
      }
      return this.startAuthorizationAttempt({ abortController, nonce, origin, popup, state });
    } catch (e) {
      popup?.close();
      LOGGER.warn("identity.google.implicit_authorization.failed", {
        operation: "authorize",
        stage: "request_setup",
        code: "google_authorization_failed",
        ...safeErrorLogFields(e),
      });
      return Promise.resolve(Result.err({ code: "google_authorization_failed", cause: e }));
    }
  }

  private startAuthorizationAttempt({
    abortController,
    nonce,
    origin,
    popup,
    state,
  }: AuthorizationAttemptSetup): Promise<
    GoogleImplicitAuthorizationResult<GoogleIdentityCredentials>
  > {
    return new Promise((resolve) => {
      const attempt: AuthorizationAttempt = {
        nonce,
        abortController,
        messageListener: () => undefined,
        popup,
        responseReceived: false,
        resolve,
        state,
      };
      this.activeAttempt = attempt;
      attempt.messageListener = (event) => {
        try {
          const isFromExpectedPopup =
            event.origin === origin && popup.isMessageSource(event.source);
          const isActiveAttempt = this.activeAttempt === attempt && !attempt.responseReceived;
          const message = event.data as unknown;
          const isExpectedMessage =
            typeof message === "object" &&
            message !== null &&
            !Array.isArray(message) &&
            "type" in message &&
            message.type === GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE;

          if (!isFromExpectedPopup || !isActiveAttempt || !isExpectedMessage) {
            return;
          }
          attempt.responseReceived = true;
          if (attempt.poll !== undefined) clearInterval(attempt.poll);
          attempt.popup.close();
          void this.handleResponseMessage(attempt, message).catch((e: unknown) => {
            this.failAttempt(attempt, "response_handler", e);
          });
        } catch (e) {
          this.failAttempt(attempt, "message_listener", e);
        }
      };
      try {
        globalThis.window.addEventListener("message", attempt.messageListener);
        attempt.poll = setInterval(() => this.finishIfPopupClosed(attempt), POPUP_POLL_MS);
        attempt.timeout = setTimeout(() => {
          LOGGER.warn("identity.google.implicit_authorization.failed", {
            operation: "authorize",
            stage: "timeout",
            code: "google_authorization_failed",
            reason: "authorization_timed_out",
          });
          this.finish(
            attempt,
            Result.err({
              code: "google_authorization_failed",
              reason: "authorization_timed_out",
            }),
          );
        }, AUTHORIZATION_TIMEOUT_MS);
      } catch (e) {
        this.failAttempt(attempt, "attempt_setup", e);
      }
    });
  }

  /** Settles any active request as failed and releases all resources owned by the attempt. */
  dispose(): void {
    const attempt = this.activeAttempt;
    if (attempt) {
      this.finish(
        attempt,
        Result.err({
          code: "google_authorization_failed",
          reason: "authorization_disposed",
        }),
      );
    }
  }

  private finishIfPopupClosed(attempt: AuthorizationAttempt): void {
    try {
      if (this.activeAttempt !== attempt || attempt.responseReceived) return;
      if (attempt.popup.isClosed()) {
        this.finish(attempt, Result.err({ code: "google_authorization_popup_closed" }));
      }
    } catch (e) {
      this.failAttempt(attempt, "popup_poll", e);
    }
  }

  private async handleResponseMessage(
    attempt: AuthorizationAttempt,
    capture: unknown,
  ): Promise<void> {
    const result = await this.resolveCredentialsFromResponse(attempt, capture);
    if (this.activeAttempt === attempt) this.finish(attempt, result);
  }

  private async resolveCredentialsFromResponse(
    attempt: AuthorizationAttempt,
    capture: unknown,
  ): Promise<GoogleImplicitAuthorizationResult<GoogleIdentityCredentials>> {
    const parsed = parseGoogleAuthorizationResponse(capture, attempt.state, attempt.nonce);
    if (Result.isError(parsed)) {
      LOGGER.warn("identity.google.implicit_authorization.failed", {
        operation: "authorize",
        stage: "response",
        code: parsed.error.code,
      });
      return Result.err(parsed.error);
    }
    const account = await fetchGoogleAccountProfile(
      parsed.value.accessToken,
      parsed.value.googleSubject,
      attempt.abortController.signal,
    );
    if (Result.isError(account)) {
      LOGGER.warn("identity.google.implicit_authorization.failed", {
        operation: "authorize",
        stage: account.error.stage,
        code: account.error.code,
        ...(account.error.httpStatus === undefined ? {} : { httpStatus: account.error.httpStatus }),
        ...(account.error.cause === undefined ? {} : safeErrorLogFields(account.error.cause)),
      });
      return Result.err({
        code: account.error.code,
        ...(account.error.cause === undefined ? {} : { cause: account.error.cause }),
      });
    }
    return Result.ok({
      googleIdToken: parsed.value.googleIdToken,
      driveAccessToken: parsed.value.accessToken,
      googleAccount: account.value,
    });
  }

  private failAttempt(
    attempt: AuthorizationAttempt,
    stage: "attempt_setup" | "message_listener" | "popup_poll" | "response_handler",
    error: unknown,
  ): void {
    LOGGER.warn("identity.google.implicit_authorization.failed", {
      operation: "authorize",
      stage,
      code: "google_authorization_failed",
      ...safeErrorLogFields(error),
    });
    if (this.activeAttempt === attempt) {
      this.finish(attempt, Result.err({ code: "google_authorization_failed", cause: error }));
    }
  }

  private finish(
    attempt: AuthorizationAttempt,
    result: GoogleImplicitAuthorizationResult<GoogleIdentityCredentials>,
  ): void {
    if (this.activeAttempt !== attempt) return;
    this.activeAttempt = null;
    if (attempt.poll !== undefined) {
      cleanupAuthorizationAttempt("clear_poll", () => clearInterval(attempt.poll));
    }
    if (attempt.timeout !== undefined) {
      cleanupAuthorizationAttempt("clear_timeout", () => clearTimeout(attempt.timeout));
    }
    cleanupAuthorizationAttempt("remove_message_listener", () => {
      globalThis.window.removeEventListener("message", attempt.messageListener);
    });
    cleanupAuthorizationAttempt("abort_requests", () => attempt.abortController.abort());
    attempt.popup.close();
    attempt.resolve(result);
  }
}

function cleanupAuthorizationAttempt(operation: string, cleanup: () => void): void {
  try {
    cleanup();
  } catch (e) {
    LOGGER.warn("identity.google.implicit_authorization.cleanup_failed", {
      operation,
      ...safeErrorLogFields(e),
    });
  }
}

function randomBase64Url(byteLength: number): string {
  return encodeBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(byteLength)));
}
