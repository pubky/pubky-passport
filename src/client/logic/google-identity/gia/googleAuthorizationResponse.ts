import "client-only";

import { Result, type Result as ResultType } from "better-result";

import {
  EARLY_GOOGLE_IMPLICIT_RESPONSE_MAX_CHARACTERS,
  GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE,
} from "../../../../libs/authorization/earlyGoogleImplicitResponse";
import { decodeBase64Url } from "../../../../libs/encoding/base64Url";

const GOOGLE_DRIVE_APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_USER_INFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const GOOGLE_USER_INFO_PROFILE_SCOPE = "https://www.googleapis.com/auth/userinfo.profile";
const MAXIMUM_TOKEN_CHARACTERS = 16 * 1024;
const ALLOWED_SCOPES = new Set([
  "openid",
  "email",
  "profile",
  GOOGLE_USER_INFO_EMAIL_SCOPE,
  GOOGLE_USER_INFO_PROFILE_SCOPE,
  GOOGLE_DRIVE_APP_DATA_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
]);

export const GOOGLE_AUTHORIZATION_SCOPE = [
  "openid",
  "email",
  "profile",
  GOOGLE_DRIVE_APP_DATA_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
].join(" ");

type ParsedGoogleAuthorizationResponse = {
  accessToken: string;
  googleIdToken: string;
  googleSubject: string;
};

type GoogleAuthorizationResponseError = {
  code: "google_authorization_denied" | "google_authorization_failed";
};

/** Pure validation of the captured OAuth fragment and ID-token binding fields. */
export function parseGoogleAuthorizationResponse(
  capture: unknown,
  expectedState: string,
  expectedNonce: string,
): ResultType<ParsedGoogleAuthorizationResponse, GoogleAuthorizationResponseError> {
  if (!isRecord(capture)
    || capture.type !== GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE
    || capture.status !== "captured"
    || typeof capture.hash !== "string"
    || capture.hash.length === 0
    || capture.hash.length > EARLY_GOOGLE_IMPLICIT_RESPONSE_MAX_CHARACTERS) {
    return Result.err({ code: "google_authorization_failed" });
  }

  const params = new URLSearchParams(capture.hash.slice(1));
  const state = oneValue(params, "state");
  if (params.has("error")) {
    if (state !== expectedState) return Result.err({ code: "google_authorization_failed" });
    return Result.err({
      code: oneValue(params, "error") === "access_denied"
        ? "google_authorization_denied"
        : "google_authorization_failed",
    });
  }

  const googleIdToken = oneValue(params, "id_token");
  const accessToken = oneValue(params, "access_token");
  const scope = oneValue(params, "scope");
  if (state !== expectedState
    || !boundedToken(googleIdToken)
    || !boundedToken(accessToken)
    || !hasAllowedScopes(scope)) {
    return Result.err({ code: "google_authorization_failed" });
  }

  const googleSubject = readIdTokenSubject(googleIdToken, expectedNonce);
  return googleSubject
    ? Result.ok({ accessToken, googleIdToken, googleSubject })
    : Result.err({ code: "google_authorization_failed" });
}

function readIdTokenSubject(token: string, expectedNonce: string): string | null {
  const segments = token.split(".");
  if (segments.length !== 3 || !segments[1]) return null;
  const bytes = decodeBase64Url(segments[1]);
  if (!bytes || bytes.byteLength > 8 * 1024) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return isRecord(value)
      && typeof value.sub === "string"
      && value.sub.length > 0
      && value.sub.length <= 255
      && value.nonce === expectedNonce
      ? value.sub
      : null;
  } catch {
    return null;
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
