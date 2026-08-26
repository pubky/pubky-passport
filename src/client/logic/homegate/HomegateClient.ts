import "client-only";

import { Result } from "better-result";
import { z } from "zod";

import { readBoundedText } from "../../../libs/http/boundedBody";
import { LOGGER } from "../../../libs/logger/logger";
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

const MAX_SUCCESS_RESPONSE_BYTES = 16 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 256;
const MAX_SIGNUP_CODE_LENGTH = 1024;
const MAX_GOOGLE_ID_TOKEN_LENGTH = 16 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const GOOGLE_VERIFICATION_PATH = "google_verification";
const SIGNUP_CODE_SCHEMA = z.string().min(1).max(MAX_SIGNUP_CODE_LENGTH)
  .refine((value) => value.trim().length > 0);
const INVITATION_SCHEMA = z.object({
  signupCode: SIGNUP_CODE_SCHEMA,
  homeserverPubky: z.string().refine(isPubkyPublicKey),
}).strict();

export function createGoogleSignupInvitationRequester(
  homegateBaseUrl: string,
  fetchImpl: typeof globalThis.fetch,
): (
  googleIdToken: string,
) => Promise<Result<HomeserverSignupInvitation, CodedFailure<HomegateSignupInvitationErrorCode>>> {
  const googleVerificationEndpoint = new URL(GOOGLE_VERIFICATION_PATH, homegateBaseUrl);
  return async (
    googleIdToken: string,
  ): Promise<Result<HomeserverSignupInvitation, CodedFailure<HomegateSignupInvitationErrorCode>>> => {
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
      response = await fetchImpl(googleVerificationEndpoint, {
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
      });
      return Result.err({ code: "network_failed", cause });
    }

    const responseText = await readBoundedText(
      response,
      response.ok ? MAX_SUCCESS_RESPONSE_BYTES : MAX_ERROR_RESPONSE_BYTES,
    );
    if (responseText === null && signal.aborted) {
      LOGGER.warn("identity.google.homeserver_signup_invitation.failed", {
        operation: "request_google_invitation",
        stage: "response_read",
        code: "network_failed",
      });
      return Result.err({ code: "network_failed" });
    }
    if (responseText === null || responseText === "too_large") {
      const code = response.ok ? "malformed_homegate_response" : "homegate_unavailable";
      LOGGER.warn("identity.google.homeserver_signup_invitation.failed", {
        operation: "request_google_invitation",
        stage: "response_read",
        code,
      });
      return Result.err({ code });
    }

    if (!response.ok) {
      const code = mapHomegateError(responseText);
      LOGGER.warn("identity.google.homeserver_signup_invitation.failed", {
        operation: "request_google_invitation",
        stage: "error_response",
        code,
      });
      return Result.err({ code });
    }

    let responseJson: unknown;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      LOGGER.warn("identity.google.homeserver_signup_invitation.failed", {
        operation: "request_google_invitation",
        stage: "response_parse",
        code: "malformed_homegate_response",
      });
      return Result.err({ code: "malformed_homegate_response" });
    }

    const invitation = INVITATION_SCHEMA.safeParse(responseJson);
    if (invitation.success) return Result.ok(invitation.data);
    LOGGER.warn("identity.google.homeserver_signup_invitation.failed", {
      operation: "request_google_invitation",
      stage: "response_validation",
      code: "malformed_homegate_response",
    });
    return Result.err({ code: "malformed_homegate_response" });
  };
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
  return value.length <= MAX_GOOGLE_ID_TOKEN_LENGTH
    && value.trim().length > 0;
}
