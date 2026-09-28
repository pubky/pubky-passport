import "client-only";

import { Result } from "better-result";

import { LOGGER } from "@/libs/logger/logger";
import { MAXIMUM_JSON_BODY_BYTES } from "@/libs/passportPolicy";
import type { HomeserverSignupDetails } from "@/client/logic/signup/homeserverInvite";
import { homegateSignupSchema, signupDetails } from "./homegateSignup";
import { HomegateTransport, type HomegateFailure } from "./HomegateTransport";

export type HomegateSignupTokenErrorCode =
  | "invalid_google_id_token"
  | "weekly_limit_exceeded"
  | "annual_limit_exceeded"
  | "homegate_invalid_request"
  | "homeserver_unavailable"
  | "google_verifier_unavailable"
  | "homegate_unavailable"
  | "malformed_homegate_response"
  | "network_failed";

const EVENT = "identity.google.homeserver_signup_token.failed";
const OPERATION = "request_google_signup_token";
// The Google route answers with exactly the invite fields; anything else is not trusted.
const SIGNUP_TOKEN_RESPONSE_SCHEMA = homegateSignupSchema.strict().transform(signupDetails);

/** Exchanges Google identity assertions for homeserver signup invitations through Homegate. */
export class HomegateClient {
  private readonly transport: HomegateTransport<HomegateSignupTokenErrorCode>;

  /** @throws {TypeError} when the Homegate base URL is invalid. */
  constructor(homegateBaseUrl: string, fetch: typeof globalThis.fetch) {
    this.transport = new HomegateTransport(homegateBaseUrl, fetch, EVENT, mapHomegateError);
  }

  /**
   * Exchanges a Google ID token for a homeserver signup token from Homegate.
   *
   * The promise settles with a Result for request and response failures. It does not
   * intentionally reject.
   */
  async requestGoogleSignupToken(
    googleIdToken: string,
  ): Promise<Result<HomeserverSignupDetails, HomegateFailure<HomegateSignupTokenErrorCode>>> {
    if (!isValidGoogleIdToken(googleIdToken)) {
      LOGGER.warn(EVENT, {
        operation: OPERATION,
        stage: "input_validation",
        code: "homegate_invalid_request",
      });
      return Result.err({ code: "homegate_invalid_request" });
    }
    return this.transport.request("/google_verification", OPERATION, SIGNUP_TOKEN_RESPONSE_SCHEMA, {
      body: { googleIdToken },
    });
  }
}

function mapHomegateError(body: string | null): HomegateSignupTokenErrorCode {
  if (body === null) return "homegate_unavailable";
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
