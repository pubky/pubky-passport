import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { encodeBase64Url } from "../../../../libs/encoding/base64Url";
import { LOGGER } from "../../../../libs/logger/logger";
import { AUTHORIZATION_TIMEOUT_MS } from "../../../../libs/passportPolicy";
import type { CodedFailure } from "../../../../libs/result";
import { GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE } from "../../../../libs/authorization/earlyGoogleImplicitResponse";
import type { GoogleAccountProfile } from "../../local-identity/localIdentityModels";
import {
  GOOGLE_AUTHORIZATION_SCOPE,
  parseGoogleAuthorizationResponse,
} from "./googleAuthorizationResponse";
import { fetchGoogleAccountProfile } from "./googleProfileFetcher";

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
export type GoogleImplicitAuthorizationError = CodedFailure<GoogleImplicitAuthorizationErrorCode>;
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
  popup: Window;
  poll: ReturnType<typeof setInterval>;
  responseReceived: boolean;
  resolve(result: GoogleImplicitAuthorizationResult<GoogleIdentityCredentials>): void;
  state: string;
  timeout: ReturnType<typeof setTimeout>;
};

export class GoogleImplicitAuthorization {
  private activeAttempt: AuthorizationAttempt | null = null;

  constructor(private readonly clientId: string) {}

  request(loginHint?: string): Promise<GoogleImplicitAuthorizationResult<GoogleIdentityCredentials>> {
    if (this.activeAttempt) {
      LOGGER.warn("identity.google.implicit_authorization.failed", {
        operation: "authorize",
        stage: "request",
        code: "google_authorization_failed",
      });
      return Promise.resolve(Result.err({ code: "google_authorization_failed" }));
    }
    let popup: Window | null = null;
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

      popup = globalThis.open(url, `pubky-passport-google-${state}`, "popup,width=520,height=680");
      if (!popup) {
        LOGGER.warn("identity.google.implicit_authorization.failed", {
          operation: "authorize",
          stage: "popup",
          code: "google_authorization_popup_failed_to_open",
        });
        return Promise.resolve(Result.err({ code: "google_authorization_popup_failed_to_open" }));
      }
      const openedPopup = popup;

      return new Promise((resolve) => {
        const attempt: AuthorizationAttempt = {
          nonce,
          abortController,
          messageListener: () => undefined,
          popup: openedPopup,
          poll: 0 as unknown as ReturnType<typeof setInterval>,
          responseReceived: false,
          resolve,
          state,
          timeout: 0 as unknown as ReturnType<typeof setTimeout>,
        };
        this.activeAttempt = attempt;
        attempt.messageListener = (event) => {
          try {
            if (event.origin !== origin
              || event.source !== openedPopup
              || this.activeAttempt !== attempt
              || attempt.responseReceived
              || !isRecord(event.data)
              || event.data.type !== GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE) return;
            attempt.responseReceived = true;
            clearInterval(attempt.poll);
            closePopup(attempt.popup);
            void this.handleResponseMessage(attempt, event.data).catch((error: unknown) => {
              this.failAttempt(attempt, "response_handler", error);
            });
          } catch (error) {
            this.failAttempt(attempt, "message_listener", error);
          }
        };
        try {
          globalThis.window.addEventListener("message", attempt.messageListener);
          attempt.poll = setInterval(() => this.inspectPopup(attempt), POPUP_POLL_MS);
          attempt.timeout = setTimeout(() => {
            LOGGER.warn("identity.google.implicit_authorization.failed", {
              operation: "authorize",
              stage: "timeout",
              code: "google_authorization_failed",
            });
            this.finish(attempt, Result.err({ code: "google_authorization_failed" }));
          }, AUTHORIZATION_TIMEOUT_MS);
        } catch (error) {
          this.failAttempt(attempt, "attempt_setup", error);
        }
      });
    } catch (error) {
      if (popup) closePopup(popup);
      LOGGER.warn("identity.google.implicit_authorization.failed", {
        operation: "authorize",
        stage: "request_setup",
        code: "google_authorization_failed",
      });
      return Promise.resolve(Result.err({ code: "google_authorization_failed", cause: error }));
    }
  }

  dispose(): void {
    const attempt = this.activeAttempt;
    if (attempt) this.finish(attempt, Result.err({ code: "google_authorization_failed" }));
  }

  private inspectPopup(attempt: AuthorizationAttempt): void {
    try {
      if (this.activeAttempt !== attempt || attempt.responseReceived) return;
      if (attempt.popup.closed) {
        this.finish(attempt, Result.err({ code: "google_authorization_popup_closed" }));
      }
    } catch (error) {
      this.failAttempt(attempt, "popup_poll", error);
    }
  }

  private async handleResponseMessage(attempt: AuthorizationAttempt, capture: unknown): Promise<void> {
    const result = await this.parseReturn(attempt, capture);
    if (this.activeAttempt === attempt) this.finish(attempt, result);
  }

  private async parseReturn(
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
      });
      return Result.err({ code: account.error.code, ...(account.error.cause ? { cause: account.error.cause } : {}) });
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
    cleanupAuthorizationAttempt("clear_poll", () => clearInterval(attempt.poll));
    cleanupAuthorizationAttempt("clear_timeout", () => clearTimeout(attempt.timeout));
    cleanupAuthorizationAttempt("remove_message_listener", () => {
      globalThis.window.removeEventListener("message", attempt.messageListener);
    });
    cleanupAuthorizationAttempt("abort_requests", () => attempt.abortController.abort());
    cleanupAuthorizationAttempt("close_popup", () => closePopup(attempt.popup));
    attempt.resolve(result);
  }
}

function cleanupAuthorizationAttempt(operation: string, cleanup: () => void): void {
  try {
    cleanup();
  } catch {
    LOGGER.warn("identity.google.implicit_authorization.cleanup_failed", { operation });
  }
}

function closePopup(popup: Window): void {
  try {
    if (!popup.closed) popup.close();
  } catch { /* Cross-origin popup cleanup is best effort. */ }
}

function randomBase64Url(byteLength: number): string {
  return encodeBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(byteLength)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
