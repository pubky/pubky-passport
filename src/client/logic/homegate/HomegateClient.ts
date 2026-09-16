import "client-only";

import type { Result } from "better-result";

import { createFailure } from "@/libs/logger/createFailure";
import { MAXIMUM_JSON_BODY_BYTES } from "@/libs/passportPolicy";
import { HomegateTransport, type HomegateFailure } from "./HomegateTransport";
import {
  homegateSignupSchema,
  signupDetails,
  type HomeserverSignupDetails,
} from "./homegateSignup";

export type { HomeserverSignupDetails } from "./homegateSignup";

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

const FAILURE_EVENT = "identity.google.homeserver_signup_token.failed";
const failure = createFailure<HomegateSignupTokenErrorCode>(FAILURE_EVENT);

/** Exchanges Google identity assertions for homeserver signup invitations through Homegate. */
export class HomegateClient {
  private readonly transport: HomegateTransport<HomegateSignupTokenErrorCode>;

  /** @throws {TypeError} when the Homegate base URL is invalid. */
  constructor(homegateBaseUrl: string, fetch: typeof globalThis.fetch) {
    this.transport = new HomegateTransport(homegateBaseUrl, fetch, FAILURE_EVENT, mapHomegateError);
  }

  /** Exchanges a Google ID token for an invite; request and response failures settle as Results. */
  async requestGoogleSignupToken(
    googleIdToken: string,
  ): Promise<Result<HomeserverSignupDetails, HomegateFailure<HomegateSignupTokenErrorCode>>> {
    if (!isValidGoogleIdToken(googleIdToken)) {
      return failure({
        operation: "request_google_signup_token",
        stage: "input_validation",
        code: "homegate_invalid_request",
      });
    }
    return this.transport.request(
      "/google_verification",
      "request_google_signup_token",
      homegateSignupSchema.strict().transform(signupDetails),
      { body: { googleIdToken } },
    );
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
    case "internal_error":
      return "homegate_unavailable";
    default:
      return "malformed_homegate_response";
  }
}

function isValidGoogleIdToken(value: string): boolean {
  return value.length <= MAXIMUM_JSON_BODY_BYTES && value.trim().length > 0;
}
