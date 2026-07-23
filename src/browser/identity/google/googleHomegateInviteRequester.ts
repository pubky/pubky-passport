import "client-only";

import { Result } from "better-result";

import { readBoundedText } from "../../../libs/security/boundedBody";
import type {
  GoogleHomegateInviteRequester,
  GoogleHomegateInviteRequesterErrorCode,
  HomeserverSignupInvitation,
} from "./applicationContracts";

const maximumResponseBytes = 16 * 1024;
const maximumInvitationFieldCharacters = 1024;
const knownErrorCodes = new Set<GoogleHomegateInviteRequesterErrorCode>([
  "invalid_google_id_token",
  "weekly_limit_exceeded",
  "annual_limit_exceeded",
  "homegate_invalid_request",
  "homeserver_unavailable",
  "google_verifier_unavailable",
  "homegate_unavailable",
  "malformed_homegate_response",
]);

export class BrowserGoogleHomegateInviteRequester implements GoogleHomegateInviteRequester {
  readonly #fetch: typeof fetch;
  readonly #origin: string;

  constructor(options: { fetch?: typeof fetch; origin?: string } = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#origin = options.origin ?? globalThis.location?.origin ?? "";
  }

  async requestSignupInvitation(input: { googleIdToken: string }) {
    let response: Response;
    try {
      const endpoint = this.#origin
        ? new URL("/api/homegate/google/invite", this.#origin)
        : "/api/homegate/google/invite";
      response = await this.#fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ googleIdToken: input.googleIdToken }),
        credentials: "same-origin",
      });
    } catch {
      return failure("network_failed");
    }

    const contents = await readBoundedText(response, maximumResponseBytes);
    if (contents === null || contents === "too_large") return failure("invalid_response");

    let body: unknown;
    try {
      body = JSON.parse(contents);
    } catch {
      return failure("invalid_response");
    }

    if (!response.ok) {
      const code = parseErrorCode(body);
      return failure(code ?? "invalid_response");
    }

    const invitation = parseInvitation(body);
    return invitation ? Result.ok(invitation) : failure("invalid_response");
  }
}

function parseInvitation(value: unknown): HomeserverSignupInvitation | null {
  if (!isExactRecord(value, ["signupCode", "homeserverPubky"])) return null;
  if (!isBoundedNonEmptyString(value.signupCode) || !isBoundedNonEmptyString(value.homeserverPubky)) return null;
  return { signupCode: value.signupCode, homeserverPubky: value.homeserverPubky };
}

function parseErrorCode(value: unknown): GoogleHomegateInviteRequesterErrorCode | null {
  if (!isExactRecord(value, ["error"]) || !isExactRecord(value.error, ["code"])) return null;
  if (typeof value.error.code !== "string" || !knownErrorCodes.has(value.error.code as GoogleHomegateInviteRequesterErrorCode)) return null;
  return value.error.code as GoogleHomegateInviteRequesterErrorCode;
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isBoundedNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumInvitationFieldCharacters;
}

function failure(code: GoogleHomegateInviteRequesterErrorCode) {
  return Result.err({ code });
}
