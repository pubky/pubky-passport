import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { readBoundedText } from "../../../libs/http/boundedBody";
import type { GoogleAccountProfile } from "../local-identity/localIdentityModels";

const GOOGLE_USER_INFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_AVATAR_HOST = "lh3.googleusercontent.com";
const MAXIMUM_USER_INFO_BYTES = 16 * 1024;

type GoogleProfileFailure = {
  code: "google_authorization_failed";
  stage: "account_binding" | "userinfo";
  cause?: unknown;
};

/** Fetches and binds Google UserInfo without downloading optional avatar bytes. */
export async function fetchGoogleAccountProfile(
  accessToken: string,
  expectedGoogleSubject: string,
  signal: AbortSignal,
): Promise<ResultType<GoogleAccountProfile, GoogleProfileFailure>> {
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
      return Result.err({ code: "google_authorization_failed", stage: "userinfo" });
    }
    const value: unknown = JSON.parse(text);
    if (!isGoogleUserInfo(value) || value.sub !== expectedGoogleSubject) {
      return Result.err({ code: "google_authorization_failed", stage: "account_binding" });
    }
    return Result.ok({
      googleSubject: value.sub,
      email: value.email,
      name: value.name,
      pictureUrl: googleAvatarUrl(value.picture),
    });
  } catch (cause) {
    return Result.err({ code: "google_authorization_failed", stage: "userinfo", cause });
  }
}

export function isGoogleAvatarUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === GOOGLE_AVATAR_HOST
      && !url.username
      && !url.password
      && !url.hash;
  } catch {
    return false;
  }
}

function googleAvatarUrl(value: string | undefined): string | null {
  return isGoogleAvatarUrl(value) ? value : null;
}

function isGoogleUserInfo(value: unknown): value is {
  sub: string;
  email: string;
  name: string;
  picture?: string;
} {
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
