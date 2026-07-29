import "client-only";

import { Result } from "better-result";
import { z } from "zod";

import { readBoundedText } from "../../../libs/http/boundedBody";
import { LOGGER } from "../../../libs/logger/logger";
import type {
  HomegateInvitationErrorCode,
  HomeserverSignupInvitation,
} from "../application/homegateInvitation";

const MAX_SUCCESS_RESPONSE_BYTES = 16 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 256;
const MAX_INVITATION_FIELD_LENGTH = 1024;
const MAX_GOOGLE_ID_TOKEN_LENGTH = 16 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const GOOGLE_VERIFICATION_PATH = "google_verification";
const INVITATION_FIELD_SCHEMA = z.string().min(1).max(MAX_INVITATION_FIELD_LENGTH)
  .refine((value) => value.trim().length > 0);
const INVITATION_SCHEMA = z.object({
  signupCode: INVITATION_FIELD_SCHEMA,
  homeserverPubky: INVITATION_FIELD_SCHEMA,
}).strict();

export class HomegateClient {
  readonly #fetch: typeof fetch;
  readonly #googleVerificationEndpoint: URL;

  constructor(options: { homegateBaseUrl: string; fetch?: typeof fetch }) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#googleVerificationEndpoint = new URL(GOOGLE_VERIFICATION_PATH, options.homegateBaseUrl);
  }

  async requestGoogleSignupInvitation(
    googleIdToken: string,
  ): Promise<Result<HomeserverSignupInvitation, { code: HomegateInvitationErrorCode }>> {
    if (!isValidGoogleIdToken(googleIdToken)) return failure("homegate_invalid_request");

    let signal: AbortSignal;
    let response: Response;
    try {
      signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      response = await this.#fetch(this.#googleVerificationEndpoint, {
        method: "POST",
        headers: { Accept: "application/json, text/plain", "Content-Type": "application/json" },
        body: JSON.stringify(googleIdToken),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal,
      });
    } catch (error) {
      LOGGER.warn("identity.google.homegate_invite.network_failed", {
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return failure("network_failed");
    }

    const responseText = await readBoundedText(
      response,
      response.ok ? MAX_SUCCESS_RESPONSE_BYTES : MAX_ERROR_RESPONSE_BYTES,
    );
    if (responseText === null && signal.aborted) return failure("network_failed");
    if (responseText === null || responseText === "too_large") {
      return failure(response.ok ? "malformed_homegate_response" : "homegate_unavailable");
    }

    if (!response.ok) return failure(mapHomegateError(responseText));

    let responseJson: unknown;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      return failure("malformed_homegate_response");
    }

    const invitation = INVITATION_SCHEMA.safeParse(responseJson);
    return invitation.success ? Result.ok(invitation.data) : failure("malformed_homegate_response");
  }
}

function mapHomegateError(body: string): HomegateInvitationErrorCode {
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

function failure(code: HomegateInvitationErrorCode) {
  return Result.err({ code });
}
