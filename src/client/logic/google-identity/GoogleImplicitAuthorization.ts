import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { decodeBase64Url, encodeBase64Url } from "../../../libs/encoding/base64Url";
import { readBoundedBytes, readBoundedText } from "../../../libs/http/boundedBody";
import { LOGGER } from "../../../libs/logger/logger";
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
export type GoogleImplicitAuthorizationError = {
  code: GoogleImplicitAuthorizationErrorCode;
};
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

  constructor(
    private clientId: string,
    private origin: string = globalThis.location.origin,
    private open: typeof window.open = (url, target, features) => globalThis.window.open(url, target, features),
    private fetch: typeof globalThis.fetch = (request, init) => globalThis.fetch(request, init),
  ) {}

  request(loginHint?: string): Promise<GoogleImplicitAuthorizationResult<GoogleIdentityCredentials>> {
    if (this.activeAttempt) return Promise.resolve(failure("request", "google_authorization_failed"));
    const state = randomBase64Url(32);
    const nonce = randomBase64Url(32);
    const url = new URL(GOOGLE_AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      response_type: "id_token token",
      scope: GOOGLE_AUTHORIZATION_SCOPE,
      redirect_uri: this.origin,
      nonce,
      state,
      prompt: "consent",
      include_granted_scopes: "false",
      ...(loginHint ? { login_hint: loginHint } : {}),
    }).toString();

    const popup = this.open(url, `pubky-passport-google-${state}`, "popup,width=520,height=680");
    if (!popup) return Promise.resolve(failure("popup", "google_authorization_popup_failed_to_open"));

    return new Promise((resolve) => {
      const attempt: AuthorizationAttempt = {
        nonce,
        abortController: new AbortController(),
        messageListener: () => undefined,
        popup,
        poll: 0 as unknown as ReturnType<typeof setInterval>,
        responseReceived: false,
        resolve,
        state,
        timeout: 0 as unknown as ReturnType<typeof setTimeout>,
      };
      this.activeAttempt = attempt;
      attempt.messageListener = (event) => {
        if (event.origin !== this.origin
          || event.source !== popup
          || this.activeAttempt !== attempt
          || attempt.responseReceived
          || !isRecord(event.data)
          || event.data.type !== GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE) return;
        attempt.responseReceived = true;
        clearInterval(attempt.poll);
        closePopup(attempt.popup);
        void this.handleResponseMessage(attempt, event.data);
      };
      globalThis.window.addEventListener("message", attempt.messageListener);
      attempt.poll = setInterval(() => this.inspectPopup(attempt), POPUP_POLL_MS);
      attempt.timeout = setTimeout(() => {
        this.finish(attempt, failure("timeout", "google_authorization_failed"));
      }, AUTHORIZATION_TIMEOUT_MS);
    });
  }

  dispose(): void {
    const attempt = this.activeAttempt;
    if (attempt) this.finish(attempt, Result.err({ code: "google_authorization_failed" }));
  }

  private inspectPopup(attempt: AuthorizationAttempt): void {
    if (this.activeAttempt !== attempt || attempt.responseReceived) return;
    if (attempt.popup.closed) {
      this.finish(attempt, Result.err({ code: "google_authorization_popup_closed" }));
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
      return failure("response", "google_authorization_failed");
    }
    const rawFragment = capture.hash;
    if (rawFragment.length === 0 || rawFragment.length > EARLY_GOOGLE_IMPLICIT_RESPONSE_MAX_CHARACTERS) return failure("response", "google_authorization_failed");
    const params = new URLSearchParams(rawFragment.slice(1));
    if (params.has("error")) {
      return failure(
        "response",
        oneValue(params, "error") === "access_denied"
          ? "google_authorization_denied"
          : "google_authorization_failed",
      );
    }
    const state = oneValue(params, "state");
    const idToken = oneValue(params, "id_token");
    const accessToken = oneValue(params, "access_token");
    const scope = oneValue(params, "scope");
    if (state !== attempt.state
      || !boundedToken(idToken)
      || !boundedToken(accessToken)
      || !hasAllowedScopes(scope)) {
      return failure("response", "google_authorization_failed");
    }
    const googleSubject = readBoundedIdTokenSubject(idToken, attempt.nonce);
    if (!googleSubject) return failure("id_token", "google_authorization_failed");
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
      const response = await this.fetch(GOOGLE_USER_INFO_URL, {
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      const text = response.ok ? await readBoundedText(response, MAXIMUM_USER_INFO_BYTES) : null;
      if (!text || text === "too_large") return failure("userinfo", "google_authorization_failed");
      const value: unknown = JSON.parse(text);
      if (!isGoogleUserInfo(value) || value.sub !== expectedGoogleSubject) {
        return failure("account_binding", "google_authorization_failed");
      }
      const pictureUrl = value.picture ? await this.fetchAvatar(value.picture, signal) : null;
      return Result.ok({ googleSubject: value.sub, email: value.email, name: value.name, pictureUrl });
    } catch {
      return failure("userinfo", "google_authorization_failed");
    }
  }

  private async fetchAvatar(value: string, signal: AbortSignal): Promise<string | null> {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== GOOGLE_AVATAR_HOST || url.username || url.password || url.hash) return null;
      const response = await this.fetch(url, {
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

  private finish(
    attempt: AuthorizationAttempt,
    result: GoogleImplicitAuthorizationResult<GoogleIdentityCredentials>,
  ): void {
    if (this.activeAttempt !== attempt) return;
    clearInterval(attempt.poll);
    clearTimeout(attempt.timeout);
    globalThis.window.removeEventListener("message", attempt.messageListener);
    attempt.abortController.abort();
    this.activeAttempt = null;
    closePopup(attempt.popup);
    attempt.resolve(result);
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

function failure<Success>(stage: string, code: GoogleImplicitAuthorizationErrorCode): GoogleImplicitAuthorizationResult<Success> {
  LOGGER[code === "google_authorization_popup_closed" ? "info" : "warn"](
    "identity.google.implicit_authorization.failed",
    { operation: "authorize", stage, code },
  );
  return Result.err({ code });
}
