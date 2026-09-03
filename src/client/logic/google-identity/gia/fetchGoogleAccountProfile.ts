import "client-only";

import { Result, type Result as ResultType } from "better-result";

import {
  googleAccountProfileFromUserInfo,
  type GoogleAccountProfile,
} from "../../../../libs/googleAccountProfile";
import { readBoundedText } from "../../../../libs/http/boundedBody";
import { HttpResponseError } from "../../../../libs/http/HttpResponseError";
import { MAXIMUM_JSON_BODY_BYTES, REQUEST_TIMEOUT_MS } from "../../../../libs/passportPolicy";

const GOOGLE_USER_INFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

type GoogleProfileFailure = {
  code: "google_authorization_failed";
  stage: "account_binding" | "error_response" | "request" | "response_parse" | "response_read";
  cause: unknown;
  httpStatus?: number;
};

/**
 * Fetches and binds Google UserInfo without downloading optional avatar bytes.
 *
 * The promise settles with a Result for request, response, parsing, and binding failures. It
 * does not intentionally reject.
 */
export async function fetchGoogleAccountProfile(
  accessToken: string,
  expectedGoogleSubject: string,
  signal: AbortSignal,
): Promise<ResultType<GoogleAccountProfile, GoogleProfileFailure>> {
  let stage: GoogleProfileFailure["stage"] = "request";
  try {
    const response = await globalThis.fetch(GOOGLE_USER_INFO_URL, {
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    stage = "response_read";
    const contents = await readBoundedText(response, MAXIMUM_JSON_BODY_BYTES);
    if (!response.ok) {
      const responseBody = Result.isOk(contents)
        ? contents.value
        : contents.error.code === "body_too_large"
          ? "too_large"
          : null;
      return Result.err({
        code: "google_authorization_failed",
        stage: "error_response",
        httpStatus: response.status,
        cause: new HttpResponseError(response.status, response.statusText, responseBody, {
          cause: Result.isError(contents) ? contents.error.cause : undefined,
        }),
      });
    }
    if (Result.isError(contents)) {
      return Result.err({
        code: "google_authorization_failed",
        stage,
        cause: contents.error.cause,
      });
    }
    if (contents.value.length === 0) {
      return Result.err({
        code: "google_authorization_failed",
        stage,
        cause: new Error("Google UserInfo response body is empty."),
      });
    }
    stage = "response_parse";
    let userInfo: unknown;
    try {
      userInfo = JSON.parse(contents.value);
    } catch (e) {
      return Result.err({
        code: "google_authorization_failed",
        stage,
        cause: new Error("Google UserInfo response must be valid JSON.", { cause: e }),
      });
    }
    stage = "account_binding";
    const profile = googleAccountProfileFromUserInfo(userInfo, expectedGoogleSubject);
    if (!profile) {
      return Result.err({
        code: "google_authorization_failed",
        stage,
        cause: new Error("Google UserInfo did not match the authorized account."),
      });
    }
    return Result.ok(profile);
  } catch (e) {
    return Result.err({ code: "google_authorization_failed", stage, cause: e });
  }
}
