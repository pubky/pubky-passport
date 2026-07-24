import "client-only";

import { Result } from "better-result";

import { parseHomegateBaseUrl } from "../../../../libs/homegate/parseHomegateBaseUrl";
import { readBoundedText } from "../../../../libs/security/boundedBody";
import type {
  GoogleHomegateInviteRequester,
  GoogleHomegateInviteRequesterErrorCode,
  HomeserverSignupInvitation,
} from "../../application/ports/homegateInvitation";

const maximumSuccessResponseBytes = 16 * 1024;
const maximumErrorResponseBytes = 256;
const maximumInvitationFieldCharacters = 1024;
const maximumGoogleIdTokenCharacters = 16 * 1024;
const homegateRequestTimeoutMilliseconds = 10_000;
const googleVerificationPath = "google_verification";

export class BrowserGoogleHomegateInviteRequester implements GoogleHomegateInviteRequester {
  readonly #fetch: typeof fetch;
  readonly #googleVerificationEndpoint: URL;

  constructor(options: { homegateBaseUrl: string; fetch?: typeof fetch }) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#googleVerificationEndpoint = createGoogleVerificationEndpoint(options.homegateBaseUrl);
  }

  async requestSignupInvitation(input: { googleIdToken: string }) {
    if (!isValidGoogleIdToken(input.googleIdToken)) return failure("homegate_invalid_request");

    let requestSignal: AbortSignal;
    let response: Response;
    try {
      requestSignal = AbortSignal.timeout(homegateRequestTimeoutMilliseconds);
      response = await this.#fetch(this.#googleVerificationEndpoint, {
        method: "POST",
        headers: { Accept: "application/json, text/plain", "Content-Type": "application/json" },
        body: JSON.stringify({ googleIdToken: input.googleIdToken }),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: requestSignal,
      });
    } catch {
      return failure("network_failed");
    }

    const contents = await readBoundedText(
      response,
      response.ok ? maximumSuccessResponseBytes : maximumErrorResponseBytes,
    );
    if (contents === null && requestSignal.aborted) return failure("network_failed");
    if (contents === null || contents === "too_large") {
      return failure(response.ok ? "malformed_homegate_response" : "homegate_unavailable");
    }

    if (!response.ok) return failure(mapHomegateError(contents));

    let body: unknown;
    try {
      body = JSON.parse(contents);
    } catch {
      return failure("malformed_homegate_response");
    }

    const invitation = parseInvitation(body);
    return invitation ? Result.ok(invitation) : failure("malformed_homegate_response");
  }
}

function createGoogleVerificationEndpoint(homegateBaseUrl: string): URL {
  const baseUrl = parseHomegateBaseUrl(homegateBaseUrl);
  if (!baseUrl) throw new Error("Invalid Homegate URL configuration.");
  return new URL(googleVerificationPath, baseUrl.href);
}

function parseInvitation(value: unknown): HomeserverSignupInvitation | null {
  if (!isExactRecord(value, ["signupCode", "homeserverPubky"])) return null;
  if (!isBoundedNonEmptyString(value.signupCode) || !isBoundedNonEmptyString(value.homeserverPubky)) return null;
  return { signupCode: value.signupCode, homeserverPubky: value.homeserverPubky };
}

function mapHomegateError(body: string): GoogleHomegateInviteRequesterErrorCode {
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

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isBoundedNonEmptyString(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumInvitationFieldCharacters
    && value.trim().length > 0;
}

function isValidGoogleIdToken(value: string): boolean {
  return value.length > 0
    && value.length <= maximumGoogleIdTokenCharacters
    && value.trim().length > 0;
}

function failure(code: GoogleHomegateInviteRequesterErrorCode) {
  return Result.err({ code });
}
