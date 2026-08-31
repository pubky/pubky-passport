import "client-only";

import { Result, type Result as ResultType } from "better-result";

import {
  googleAccountProfileFromUserInfo,
  type GoogleAccountProfile,
} from "../../../../libs/googleAccountProfile";
import { readBoundedText } from "../../../../libs/http/boundedBody";
import { MAXIMUM_JSON_BODY_BYTES, REQUEST_TIMEOUT_MS } from "../../../../libs/passportPolicy";

const GOOGLE_USER_INFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

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
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    const text = response.ok ? await readBoundedText(response, MAXIMUM_JSON_BODY_BYTES) : null;
    if (!text || text === "too_large") {
      return Result.err({ code: "google_authorization_failed", stage: "userinfo" });
    }
    const userInfo: unknown = JSON.parse(text);
    const profile = googleAccountProfileFromUserInfo(userInfo, expectedGoogleSubject);
    if (!profile) {
      return Result.err({ code: "google_authorization_failed", stage: "account_binding" });
    }
    return Result.ok(profile);
  } catch (cause) {
    return Result.err({ code: "google_authorization_failed", stage: "userinfo", cause });
  }
}
