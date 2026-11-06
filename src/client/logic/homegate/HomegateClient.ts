import "client-only";

import { Result } from "better-result";
import { z } from "zod";

import { readBoundedText } from "@/libs/http/boundedBody";
import { HttpResponseError } from "@/libs/http/HttpResponseError";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { MAXIMUM_JSON_BODY_BYTES, REQUEST_TIMEOUT_MS } from "@/libs/passportPolicy";
import type { CodedFailure } from "@/libs/result";
import { isPubkyPublicKey } from "@/client/logic/pubky/pubkyIdentityKey";

export type HomeserverSignupDetails = {
  signupToken: string;
  homeserverPubky: string;
};

export type HomegateSignupTokenErrorCode =
  | "invalid_google_id_token"
  | "invalid_apple_id_token"
  | "apple_verifier_unavailable"
  | "weekly_limit_exceeded"
  | "annual_limit_exceeded"
  | "homegate_invalid_request"
  | "homeserver_unavailable"
  | "google_verifier_unavailable"
  | "homegate_unavailable"
  | "malformed_homegate_response"
  | "network_failed";

const MAX_ERROR_RESPONSE_BYTES = 256;
const MAX_SIGNUP_TOKEN_LENGTH = 1024;
const VERIFICATION_ENDPOINTS = {
  google: { path: "/google_verification", tokenField: "googleIdToken" },
  apple: { path: "/apple_verification", tokenField: "appleIdToken" },
} as const;
type SignupProvider = keyof typeof VERIFICATION_ENDPOINTS;
type SignupTokenResult = Result<
  HomeserverSignupDetails,
  CodedFailure<HomegateSignupTokenErrorCode> & { httpStatus?: number }
>;
const SIGNUP_TOKEN_SCHEMA = z
  .string()
  .min(1)
  .max(MAX_SIGNUP_TOKEN_LENGTH)
  .refine((value) => value.trim().length > 0);
const SIGNUP_TOKEN_RESPONSE_SCHEMA = z
  .object({
    // Homegate's wire format calls this signupCode; the Pubky SDK calls it a signup token.
    signupCode: SIGNUP_TOKEN_SCHEMA,
    homeserverPubky: z.string().refine(isPubkyPublicKey),
  })
  .strict()
  .transform(({ signupCode, homeserverPubky }) => ({ signupToken: signupCode, homeserverPubky }));

/** Exchanges Google or Apple identity assertions for homeserver signup invitations through Homegate. */
export class HomegateClient {
  private readonly endpoints: Readonly<Record<SignupProvider, URL>>;

  /** @throws {TypeError} when the Homegate base URL is invalid. */
  constructor(
    homegateBaseUrl: string,
    private readonly fetch: typeof globalThis.fetch,
  ) {
    this.endpoints = {
      google: new URL(VERIFICATION_ENDPOINTS.google.path, homegateBaseUrl),
      apple: new URL(VERIFICATION_ENDPOINTS.apple.path, homegateBaseUrl),
    };
  }

  /**
   * Exchanges a Google ID token for a homeserver signup token from Homegate.
   *
   * The promise settles with a Result for request and response failures. It does not
   * intentionally reject.
   */
  async requestGoogleSignupToken(googleIdToken: string): Promise<SignupTokenResult> {
    return this.requestSignupToken("google", googleIdToken);
  }

  /**
   * Exchanges a Sign in with Apple ID token for a homeserver signup token from Homegate.
   *
   * The promise settles with a Result for request and response failures. It does not
   * intentionally reject.
   */
  async requestAppleSignupToken(appleIdToken: string): Promise<SignupTokenResult> {
    return this.requestSignupToken("apple", appleIdToken);
  }

  private async requestSignupToken(
    provider: SignupProvider,
    idToken: string,
  ): Promise<SignupTokenResult> {
    const event = `identity.${provider}.homeserver_signup_token.failed`;
    const operation = `request_${provider}_signup_token`;
    if (!isValidIdToken(idToken)) {
      LOGGER.warn(event, {
        operation,
        stage: "input_validation",
        code: "homegate_invalid_request",
      });
      return Result.err({ code: "homegate_invalid_request" });
    }

    let signal: AbortSignal;
    let response: Response;
    try {
      signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      response = await this.fetch(this.endpoints[provider], {
        method: "POST",
        headers: { Accept: "application/json, text/plain", "Content-Type": "application/json" },
        body: JSON.stringify({ [VERIFICATION_ENDPOINTS[provider].tokenField]: idToken }),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal,
      });
    } catch (e) {
      LOGGER.warn(event, {
        operation,
        stage: "request",
        ...safeErrorLogFields(e),
        code: "network_failed",
      });
      return Result.err({ code: "network_failed", cause: e });
    }

    const responseText = await readBoundedText(
      response,
      response.ok ? MAXIMUM_JSON_BODY_BYTES : MAX_ERROR_RESPONSE_BYTES,
    );
    if (Result.isError(responseText) && signal.aborted) {
      LOGGER.warn(event, {
        operation,
        stage: "response_read",
        httpStatus: response.status,
        ...safeErrorLogFields(responseText.error.cause),
        code: "network_failed",
      });
      return Result.err({
        code: "network_failed",
        httpStatus: response.status,
        cause: responseText.error.cause,
      });
    }
    if (Result.isError(responseText)) {
      const code = response.ok ? "malformed_homegate_response" : "homegate_unavailable";
      LOGGER.warn(event, {
        operation,
        stage: "response_read",
        httpStatus: response.status,
        ...safeErrorLogFields(responseText.error.cause),
        code,
      });
      return Result.err({ code, httpStatus: response.status, cause: responseText.error.cause });
    }

    if (!response.ok) {
      const code = mapHomegateError(responseText.value);
      const cause = new HttpResponseError(response.status, response.statusText, responseText.value);
      LOGGER.warn(event, {
        operation,
        stage: "error_response",
        httpStatus: response.status,
        ...safeErrorLogFields(cause),
        code,
      });
      return Result.err({ code, httpStatus: response.status, cause });
    }

    let responseJson: unknown;
    try {
      responseJson = JSON.parse(responseText.value);
    } catch (e) {
      const responseError = new Error("Homegate response must be valid JSON.", { cause: e });
      LOGGER.warn(event, {
        operation,
        stage: "response_parse",
        httpStatus: response.status,
        ...safeErrorLogFields(responseError),
        code: "malformed_homegate_response",
      });
      return Result.err({
        code: "malformed_homegate_response",
        httpStatus: response.status,
        cause: responseError,
      });
    }

    const signupToken = SIGNUP_TOKEN_RESPONSE_SCHEMA.safeParse(responseJson);
    if (signupToken.success) return Result.ok(signupToken.data);
    // Zod issues may echo the signup token, so retain only a fixed diagnostic cause.
    LOGGER.warn(event, {
      operation,
      stage: "response_validation",
      httpStatus: response.status,
      code: "malformed_homegate_response",
    });
    return Result.err({
      code: "malformed_homegate_response",
      httpStatus: response.status,
      cause: new Error("Homegate response does not match the signup-token schema."),
    });
  }
}

function mapHomegateError(body: string): HomegateSignupTokenErrorCode {
  switch (body.trim()) {
    case "invalid_request":
      return "homegate_invalid_request";
    case "invalid_google_id_token":
      return "invalid_google_id_token";
    case "weekly_limit_exceeded":
      return "weekly_limit_exceeded";
    case "annual_limit_exceeded":
      return "annual_limit_exceeded";
    case "homeserver_unavailable":
      return "homeserver_unavailable";
    case "google_verifier_unavailable":
      return "google_verifier_unavailable";
    case "invalid_apple_id_token":
      return "invalid_apple_id_token";
    case "apple_verifier_unavailable":
      return "apple_verifier_unavailable";
    case "internal_error":
      return "homegate_unavailable";
    default:
      return "malformed_homegate_response";
  }
}

function isValidIdToken(value: string): boolean {
  return value.length <= MAXIMUM_JSON_BODY_BYTES && value.trim().length > 0;
}
