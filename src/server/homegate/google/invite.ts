import "server-only";

import { Result, type Result as ResultType } from "better-result";

import { getHomegateServerEnv } from "../../../libs/env/server";
import { readBoundedText } from "../../../libs/security/boundedBody";
import type { HomeserverSignupInvitation } from "../types";

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type GoogleHomegateInviteErrorCode =
  | "invalid_google_id_token"
  | "weekly_limit_exceeded"
  | "annual_limit_exceeded"
  | "homegate_invalid_request"
  | "homeserver_unavailable"
  | "google_verifier_unavailable"
  | "homegate_unavailable"
  | "malformed_homegate_response";

export type GoogleHomegateInviteResult = ResultType<HomeserverSignupInvitation, { code: GoogleHomegateInviteErrorCode }>;

export type GoogleHomegateInvite = {
  requestSignupInvitation(input: { googleIdToken: string }): Promise<GoogleHomegateInviteResult>;
};

export type CreateGoogleHomegateInviteInput = {
  homegateUrl: string;
  fetchImpl?: Fetch;
};

type HomegateSuccessResponse = {
  signupCode?: unknown;
  homeserverPubky?: unknown;
};

const googleVerificationPath = "google_verification";
const maximumHomegateResponseBytes = 16 * 1024;
const homegateTimeoutMilliseconds = 10_000;

export function createGoogleHomegateInvite(
  input: CreateGoogleHomegateInviteInput = createConfiguredGoogleHomegateInviteInput(),
): GoogleHomegateInvite {
  const endpoint = createGoogleVerificationEndpoint(input.homegateUrl);
  const fetchImpl = input.fetchImpl ?? fetch;

  return {
    async requestSignupInvitation({ googleIdToken }) {
      let response: Response;

      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json, text/plain",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ googleIdToken }),
          signal: AbortSignal.timeout(homegateTimeoutMilliseconds),
        });
      } catch {
        return failure("homegate_unavailable");
      }

      if (!response.ok) {
        return failure(await mapHomegateError(response));
      }

      return parseHomegateSuccess(response);
    },
  };
}

function createConfiguredGoogleHomegateInviteInput(): CreateGoogleHomegateInviteInput {
  const env = getHomegateServerEnv();
  return { homegateUrl: env.HOMEGATE_URL };
}

async function parseHomegateSuccess(response: Response): Promise<GoogleHomegateInviteResult> {
  const contents = await readBoundedText(response, maximumHomegateResponseBytes);
  if (contents === null || contents === "too_large") {
    return failure("malformed_homegate_response");
  }

  let body: HomegateSuccessResponse;
  try {
    body = JSON.parse(contents) as HomegateSuccessResponse;
  } catch {
    return failure("malformed_homegate_response");
  }

  if (!isNonEmptyString(body.signupCode) || !isNonEmptyString(body.homeserverPubky)) {
    return failure("malformed_homegate_response");
  }

  return Result.ok({ signupCode: body.signupCode, homeserverPubky: body.homeserverPubky });
}

async function mapHomegateError(response: Response): Promise<GoogleHomegateInviteErrorCode> {
  const body = await readBoundedText(response, maximumHomegateResponseBytes);
  if (body === null || body === "too_large") {
    return "homegate_unavailable";
  }

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

function createGoogleVerificationEndpoint(homegateUrl: string): URL {
  let base: URL;
  try {
    base = new URL(homegateUrl);
  } catch {
    throw invalidConfigurationError();
  }

  if (base.username || base.password || base.search || base.hash) {
    throw invalidConfigurationError();
  }

  base.pathname = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return new URL(googleVerificationPath, base);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function failure(code: GoogleHomegateInviteErrorCode): GoogleHomegateInviteResult {
  return Result.err({ code });
}

function invalidConfigurationError(): Error {
  return new Error("Invalid Homegate URL configuration.");
}
