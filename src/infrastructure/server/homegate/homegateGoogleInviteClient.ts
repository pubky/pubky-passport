import "server-only";

import { Result } from "better-result";

import type {
  HomegateInviteErrorCode,
  HomegateInvitePort,
  HomegateInviteResult,
  RequestGoogleHomegateInviteInput,
} from "../../../core/ports/homegateInvite";

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ServerHomegateGoogleInviteClientOptions = {
  homegateUrl: string;
  fetchImpl?: Fetch;
};

type HomegateSuccessResponse = {
  signupCode?: unknown;
  homeserverPubky?: unknown;
};

const googleVerificationPath = "google_verification";

export class ServerHomegateGoogleInviteClient implements HomegateInvitePort {
  readonly #endpoint: URL;
  readonly #fetch: Fetch;

  constructor(options: ServerHomegateGoogleInviteClientOptions) {
    this.#endpoint = new URL(googleVerificationPath, ensureTrailingSlash(options.homegateUrl));
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async requestGoogleInvite(input: RequestGoogleHomegateInviteInput): Promise<HomegateInviteResult> {
    let response: Response;

    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ googleIdToken: input.googleIdToken }),
      });
    } catch {
      return failure("homegate_unavailable");
    }

    if (!response.ok) {
      return failure(await mapHomegateError(response));
    }

    return parseHomegateSuccess(response);
  }
}

async function parseHomegateSuccess(response: Response): Promise<HomegateInviteResult> {
  let body: HomegateSuccessResponse;

  try {
    body = await response.json() as HomegateSuccessResponse;
  } catch {
    return failure("malformed_homegate_response");
  }

  if (!isNonEmptyString(body.signupCode) || !isNonEmptyString(body.homeserverPubky)) {
    return failure("malformed_homegate_response");
  }

  return Result.ok({
      signupCode: body.signupCode,
      homeserverPubky: body.homeserverPubky,
  });
}

async function mapHomegateError(response: Response): Promise<HomegateInviteErrorCode> {
  let body: string;

  try {
    body = await response.text();
  } catch {
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

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function failure(code: HomegateInviteErrorCode): HomegateInviteResult {
  return Result.err({ code });
}
