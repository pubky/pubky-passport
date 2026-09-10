import "client-only";

import { Result } from "better-result";
import { z } from "zod";

import { readBoundedText } from "../../../libs/http/boundedBody";
import { HttpResponseError } from "../../../libs/http/HttpResponseError";
import { LOGGER, safeErrorLogFields } from "../../../libs/logger/logger";
import { MAXIMUM_JSON_BODY_BYTES, REQUEST_TIMEOUT_MS } from "../../../libs/passportPolicy";
import type { CodedFailure } from "../../../libs/result";
import { isPubkyPublicKey } from "../pubky/pubkyIdentityKey";

export type HomeserverSignupInvitation = {
  signupCode: string;
  homeserverPubky: string;
};

export type HomegateSignupInvitationErrorCode =
  | "invalid_google_id_token"
  | "weekly_limit_exceeded"
  | "annual_limit_exceeded"
  | "homegate_invalid_request"
  | "homeserver_unavailable"
  | "google_verifier_unavailable"
  | "homegate_unavailable"
  | "malformed_homegate_response"
  | "network_failed";

const MAX_ERROR_RESPONSE_BYTES = 256;
const MAX_SIGNUP_CODE_LENGTH = 1024;
const GOOGLE_VERIFICATION_PATH = "/google_verification";
const SIGNUP_CODE_SCHEMA = z
  .string()
  .min(1)
  .max(MAX_SIGNUP_CODE_LENGTH)
  .refine((value) => value.trim().length > 0);
const INVITATION_SCHEMA = z
  .object({
    signupCode: SIGNUP_CODE_SCHEMA,
    homeserverPubky: z.string().refine(isPubkyPublicKey),
  })
  .strict();

/** Exchanges Google identity assertions for homeserver signup invitations through Homegate. */
export class HomegateClient {
  private readonly googleVerificationEndpoint: URL;

  /** @throws {TypeError} when the Homegate base URL is invalid. */
  constructor(
    homegateBaseUrl: string,
    private readonly fetch: typeof globalThis.fetch,
  ) {
    this.googleVerificationEndpoint = new URL(GOOGLE_VERIFICATION_PATH, homegateBaseUrl);
  }

  /**
   * Exchanges a Google ID token for a Homegate invitation.
   *
   * The promise settles with a Result for request and response failures. It does not
   * intentionally reject.
   */
  async requestGoogleSignupInvitation(
    googleIdToken: string,
  ): Promise<
    Result<
      HomeserverSignupInvitation,
      CodedFailure<HomegateSignupInvitationErrorCode> & { httpStatus?: number }
    >
  > {
    if (!isValidGoogleIdToken(googleIdToken)) {
      LOGGER.warn("identity.google.homeserver_signup_invitation.failed", {
        operation: "request_google_invitation",
        stage: "input_validation",
        code: "homegate_invalid_request",
      });
      return Result.err({ code: "homegate_invalid_request" });
    }

    let signal: AbortSignal;
    let response: Response;
    try {
      signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      response = await this.fetch(this.googleVerificationEndpoint, {
        method: "POST",
        headers: { Accept: "application/json, text/plain", "Content-Type": "application/json" },
        body: JSON.stringify({ googleIdToken }),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal,
      });
    } catch (cause) {
      LOGGER.warn("identity.google.homeserver_signup_invitation.failed", {
        operation: "request_google_invitation",
        stage: "request",
        code: "network_failed",
        ...safeErrorLogFields(cause),
      });
      return Result.err({ code: "network_failed", cause });
    }

    const responseText = await readBoundedText(
      response,
      response.ok ? MAXIMUM_JSON_BODY_BYTES : MAX_ERROR_RESPONSE_BYTES,
    );
    if (Result.isError(responseText) && signal.aborted) {
      LOGGER.warn("identity.google.homeserver_signup_invitation.failed", {
        operation: "request_google_invitation",
        stage: "response_read",
        code: "network_failed",
        httpStatus: response.status,
        ...safeErrorLogFields(responseText.error.cause),
      });
      return Result.err({
        code: "network_failed",
        httpStatus: response.status,
        cause: responseText.error.cause,
      });
    }
    if (Result.isError(responseText)) {
      const code = response.ok ? "malformed_homegate_response" : "homegate_unavailable";
      LOGGER.warn("identity.google.homeserver_signup_invitation.failed", {
        operation: "request_google_invitation",
        stage: "response_read",
        code,
        httpStatus: response.status,
        ...safeErrorLogFields(responseText.error.cause),
      });
      return Result.err({ code, httpStatus: response.status, cause: responseText.error.cause });
    }

    if (!response.ok) {
      const code = mapHomegateError(responseText.value);
      const cause = new HttpResponseError(response.status, response.statusText, responseText.value);
      LOGGER.warn("identity.google.homeserver_signup_invitation.failed", {
        operation: "request_google_invitation",
        stage: "error_response",
        code,
        httpStatus: response.status,
        ...safeErrorLogFields(cause),
      });
      return Result.err({ code, httpStatus: response.status, cause });
    }

    let responseJson: unknown;
    try {
      responseJson = JSON.parse(responseText.value);
    } catch (cause) {
      const responseError = new Error("Homegate response must be valid JSON.", { cause });
      LOGGER.warn("identity.google.homeserver_signup_invitation.failed", {
        operation: "request_google_invitation",
        stage: "response_parse",
        code: "malformed_homegate_response",
        httpStatus: response.status,
        ...safeErrorLogFields(responseError),
      });
      return Result.err({
        code: "malformed_homegate_response",
        httpStatus: response.status,
        cause: responseError,
      });
    }

    const invitation = INVITATION_SCHEMA.safeParse(responseJson);
    if (invitation.success) return Result.ok(invitation.data);
    // Zod issues may echo the signup code, so retain only a fixed diagnostic cause.
    LOGGER.warn("identity.google.homeserver_signup_invitation.failed", {
      operation: "request_google_invitation",
      stage: "response_validation",
      code: "malformed_homegate_response",
      httpStatus: response.status,
    });
    return Result.err({
      code: "malformed_homegate_response",
      httpStatus: response.status,
      cause: new Error("Homegate response does not match the invitation schema."),
    });
  }
}

function mapHomegateError(body: string): HomegateSignupInvitationErrorCode {
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
    case "internal_error":
      return "homegate_unavailable";
    default:
      return "malformed_homegate_response";
  }
}

function isValidGoogleIdToken(value: string): boolean {
  return value.length <= MAXIMUM_JSON_BODY_BYTES && value.trim().length > 0;
}
