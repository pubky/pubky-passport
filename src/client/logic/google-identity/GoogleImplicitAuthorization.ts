import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { decodeBase64Url, encodeBase64Url } from "../../../libs/encoding/base64Url";
import { readBoundedBytes, readBoundedText } from "../../../libs/http/boundedBody";
import { LOGGER } from "../../../libs/logger/logger";
import type { CodedFailure } from "../../../libs/result";
import {
  EARLY_GOOGLE_IMPLICIT_RESPONSE_MAX_CHARACTERS,
  GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE,
} from "../../../libs/authorization/earlyGoogleImplicitResponse";
import type { GoogleAccountProfile } from "../local-identity/localIdentityModels";

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
const GOOGLE_USER_INFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_AVATAR_HOST = "lh3.googleusercontent.com";
const GOOGLE_DRIVE_APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_USER_INFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const GOOGLE_USER_INFO_PROFILE_SCOPE = "https://www.googleapis.com/auth/userinfo.profile";
const GOOGLE_AUTHORIZATION_SCOPE = [
  "openid",
  "email",
  "profile",
  GOOGLE_DRIVE_APP_DATA_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
].join(" ");
const MAXIMUM_TOKEN_CHARACTERS = 16 * 1024;
const MAXIMUM_USER_INFO_BYTES = 16 * 1024;
const MAXIMUM_AVATAR_BYTES = 256 * 1024;
const POPUP_POLL_MS = 200;
const AUTHORIZATION_TIMEOUT_MS = 5 * 60_000;
const ALLOWED_SCOPES = new Set([
  "openid",
  "email",
  "profile",
  GOOGLE_USER_INFO_EMAIL_SCOPE,
  GOOGLE_USER_INFO_PROFILE_SCOPE,
  GOOGLE_DRIVE_APP_DATA_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
]);

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

  constructor(private clientId: string) {}

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
    if (!isRecord(capture)
      || capture.type !== GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE
      || capture.status !== "captured"
      || typeof capture.hash !== "string") {
      LOGGER.warn("identity.google.implicit_authorization.failed", {
        operation: "authorize",
        stage: "response",
        code: "google_authorization_failed",
      });
      return Result.err({ code: "google_authorization_failed" });
    }
    const rawFragment = capture.hash;
    if (rawFragment.length === 0 || rawFragment.length > EARLY_GOOGLE_IMPLICIT_RESPONSE_MAX_CHARACTERS) {
      LOGGER.warn("identity.google.implicit_authorization.failed", {
        operation: "authorize",
        stage: "response",
        code: "google_authorization_failed",
      });
      return Result.err({ code: "google_authorization_failed" });
    }
    const params = new URLSearchParams(rawFragment.slice(1));
    const state = oneValue(params, "state");
    if (params.has("error")) {
      if (state !== attempt.state) {
        LOGGER.warn("identity.google.implicit_authorization.failed", {
          operation: "authorize",
          stage: "response",
          code: "google_authorization_failed",
        });
        return Result.err({ code: "google_authorization_failed" });
      }
      const code = oneValue(params, "error") === "access_denied"
        ? "google_authorization_denied"
        : "google_authorization_failed";
      LOGGER.warn("identity.google.implicit_authorization.failed", {
        operation: "authorize",
        stage: "response",
        code,
      });
      return Result.err({ code });
    }
    const idToken = oneValue(params, "id_token");
    const accessToken = oneValue(params, "access_token");
    const scope = oneValue(params, "scope");
    if (state !== attempt.state
      || !boundedToken(idToken)
      || !boundedToken(accessToken)
      || !hasAllowedScopes(scope)) {
      LOGGER.warn("identity.google.implicit_authorization.failed", {
        operation: "authorize",
        stage: "response",
        code: "google_authorization_failed",
      });
      return Result.err({ code: "google_authorization_failed" });
    }
    const googleSubject = readBoundedIdTokenSubject(idToken, attempt.nonce);
    if (!googleSubject) {
      LOGGER.warn("identity.google.implicit_authorization.failed", {
        operation: "authorize",
        stage: "id_token",
        code: "google_authorization_failed",
      });
      return Result.err({ code: "google_authorization_failed" });
    }
    const account = await this.fetchGoogleAccount(accessToken, googleSubject, attempt.abortController.signal);
    return Result.isError(account)
      ? Result.err(account.error)
      : Result.ok({ googleIdToken: idToken, driveAccessToken: accessToken, googleAccount: account.value });
  }

  private async fetchGoogleAccount(
    accessToken: string,
    expectedGoogleSubject: string,
    signal: AbortSignal,
  ): Promise<GoogleImplicitAuthorizationResult<GoogleAccountProfile>> {
    try {
      const response = await globalThis.fetch(GOOGLE_USER_INFO_URL, {
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      const text = response.ok ? await readBoundedText(response, MAXIMUM_USER_INFO_BYTES) : null;
      if (!text || text === "too_large") {
        LOGGER.warn("identity.google.implicit_authorization.failed", {
          operation: "authorize",
          stage: "userinfo",
          code: "google_authorization_failed",
        });
        return Result.err({ code: "google_authorization_failed" });
      }
      const value: unknown = JSON.parse(text);
      if (!isGoogleUserInfo(value) || value.sub !== expectedGoogleSubject) {
        LOGGER.warn("identity.google.implicit_authorization.failed", {
          operation: "authorize",
          stage: "account_binding",
          code: "google_authorization_failed",
        });
        return Result.err({ code: "google_authorization_failed" });
      }
      const pictureUrl = value.picture ? await this.fetchAvatar(value.picture, signal) : null;
      return Result.ok({ googleSubject: value.sub, email: value.email, name: value.name, pictureUrl });
    } catch (error) {
      LOGGER.warn("identity.google.implicit_authorization.failed", {
        operation: "authorize",
        stage: "userinfo",
        code: "google_authorization_failed",
      });
      return Result.err({ code: "google_authorization_failed", cause: error });
    }
  }

  private async fetchAvatar(value: string, signal: AbortSignal): Promise<string | null> {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== GOOGLE_AVATAR_HOST || url.username || url.password || url.hash) return null;
      const response = await globalThis.fetch(url, {
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      });
      const contentType = response.headers.get("Content-Type")?.split(";", 1)[0]?.toLowerCase();
      if (!response.ok || !contentType || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) return null;
      const bytes = await readBoundedBytes(response, MAXIMUM_AVATAR_BYTES);
      return bytes instanceof Uint8Array && bytes.byteLength > 0
        ? `data:${contentType};base64,${bytesToBase64(bytes)}`
        : null;
    } catch {
      return null;
    }
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

function readBoundedIdTokenSubject(token: string, expectedNonce: string): string | null {
  const segments = token.split(".");
  if (segments.length !== 3 || !segments[1]) return null;
  const bytes = decodeBase64Url(segments[1]);
  if (!bytes || bytes.byteLength > 8 * 1024) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isRecord(value)
      || typeof value.sub !== "string"
      || value.sub.length === 0
      || value.sub.length > 255
      || value.nonce !== expectedNonce) return null;
    return value.sub;
  } catch {
    return null;
  }
}

function randomBase64Url(byteLength: number): string {
  return encodeBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(byteLength)));
}

function boundedToken(value: string | null): value is string {
  return value !== null && value.length > 0 && value.length <= MAXIMUM_TOKEN_CHARACTERS;
}

function hasAllowedScopes(value: string | null): boolean {
  if (!value) return false;
  const scopes = value.split(/\s+/u).filter(Boolean);
  return scopes.includes(GOOGLE_DRIVE_APP_DATA_SCOPE)
    && scopes.every((scope) => ALLOWED_SCOPES.has(scope));
}

function oneValue(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] ?? null : null;
}

function isGoogleUserInfo(value: unknown): value is { sub: string; email: string; name: string; picture?: string } {
  return isRecord(value)
    && boundedString(value.sub, 255)
    && boundedString(value.email, 320)
    && boundedString(value.name, 512)
    && (value.picture === undefined || boundedString(value.picture, 2_048));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}
