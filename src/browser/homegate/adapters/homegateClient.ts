import "client-only";

import { Result } from "better-result";
import { z } from "zod";

import { readBoundedText } from "../../../libs/http/boundedBody";
import type {
  HomegateInvitationErrorCode,
  HomeserverSignupInvitation,
} from "../application/homegateInvitation";

const maxSuccessResponseBytes = 16 * 1024;
const maxErrorResponseBytes = 256;
const maxInvitationFieldLength = 1024;
const maxGoogleIdTokenLength = 16 * 1024;
const requestTimeoutMs = 10_000;
const googleVerificationPath = "google_verification";
const invitationFieldSchema = z.string().min(1).max(maxInvitationFieldLength)
  .refine((value) => value.trim().length > 0);
const invitationSchema = z.object({
  signupCode: invitationFieldSchema,
  homeserverPubky: invitationFieldSchema,
}).strict();

export class HomegateClient {
  readonly #fetch: typeof fetch;
  readonly #googleVerificationEndpoint: URL;

  constructor(options: { homegateBaseUrl: string; fetch?: typeof fetch }) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#googleVerificationEndpoint = new URL(googleVerificationPath, options.homegateBaseUrl);
  }

  async requestGoogleSignupInvitation(input: {
    googleIdToken: string;
  }): Promise<Result<HomeserverSignupInvitation, { code: HomegateInvitationErrorCode }>> {
    if (!isValidGoogleIdToken(input.googleIdToken)) return failure("homegate_invalid_request");

    let signal: AbortSignal;
    let response: Response;
    try {
      signal = AbortSignal.timeout(requestTimeoutMs);
      response = await this.#fetch(this.#googleVerificationEndpoint, {
        method: "POST",
        headers: { Accept: "application/json, text/plain", "Content-Type": "application/json" },
        body: JSON.stringify({ googleIdToken: input.googleIdToken }),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal,
      });
    } catch {
      return failure("network_failed");
    }

    const responseText = await readBoundedText(
      response,
      response.ok ? maxSuccessResponseBytes : maxErrorResponseBytes,
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

    const invitation = invitationSchema.safeParse(responseJson);
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
  return value.length <= maxGoogleIdTokenLength
    && value.trim().length > 0;
}

function failure(code: HomegateInvitationErrorCode) {
  return Result.err({ code });
}
