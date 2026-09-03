import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpResponseError } from "../../../libs/http/HttpResponseError";
import { LOGGER } from "../../../libs/logger/logger";
import { HomegateClient, type HomegateSignupInvitationErrorCode } from "./HomegateClient";

const HOMEGATE_BASE_URL = "https://homegate.example/";
const HOMESERVER_PUBKY = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const HOMEGATE_ERROR_CASES = [
  ["invalid_request", "homegate_invalid_request"],
  ["invalid_google_id_token", "invalid_google_id_token"],
  ["weekly_limit_exceeded", "weekly_limit_exceeded"],
  ["annual_limit_exceeded", "annual_limit_exceeded"],
  ["homeserver_unavailable", "homeserver_unavailable"],
  ["google_verifier_unavailable", "google_verifier_unavailable"],
  ["internal_error", "homegate_unavailable"],
  ["unknown error containing SECRET-GOOGLE-ID-TOKEN", "malformed_homegate_response"],
] satisfies ReadonlyArray<readonly [string, HomegateSignupInvitationErrorCode]>;
const MALFORMED_SUCCESS_CASES = [
  [
    "an unknown field",
    () => jsonResponse({ signupCode: "code", homeserverPubky: HOMESERVER_PUBKY, extra: "unsafe" }),
  ],
  [
    "an empty signup code",
    () => jsonResponse({ signupCode: "", homeserverPubky: HOMESERVER_PUBKY }),
  ],
  [
    "an oversized signup code",
    () => jsonResponse({ signupCode: "x".repeat(1025), homeserverPubky: HOMESERVER_PUBKY }),
  ],
  [
    "an empty homeserver public key",
    () => jsonResponse({ signupCode: "code", homeserverPubky: "" }),
  ],
  [
    "an oversized homeserver public key",
    () => jsonResponse({ signupCode: "code", homeserverPubky: "x".repeat(1025) }),
  ],
  [
    "a non-canonical homeserver public key",
    () => jsonResponse({ signupCode: "code", homeserverPubky: "homeserver-pubky" }),
  ],
  ["a non-string field", () => jsonResponse({ signupCode: 42, homeserverPubky: HOMESERVER_PUBKY })],
  ["invalid JSON", () => new Response("not-json", { status: 200 })],
  ["an oversized body", () => new Response("x".repeat(16 * 1024 + 1), { status: 200 })],
] satisfies ReadonlyArray<readonly [string, () => Response]>;

describe("HomegateClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts only the Google ID token directly to Homegate", async () => {
    const requestSignal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(requestSignal);
    const fetch = new SanitizedFetchRecorder(
      jsonResponse({
        signupCode: "signup-code",
        homeserverPubky: HOMESERVER_PUBKY,
      }),
      requestSignal,
    );
    const client = new HomegateClient(HOMEGATE_BASE_URL, fetch.fetch);

    const result = await client.requestGoogleSignupInvitation("SECRET-GOOGLE-ID-TOKEN");

    expect(result).toEqual(
      Result.ok({
        signupCode: "signup-code",
        homeserverPubky: HOMESERVER_PUBKY,
      }),
    );
    expect(fetch.calls).toEqual([
      {
        url: "https://homegate.example/google_verification",
        method: "POST",
        headerNames: ["Accept", "Content-Type"],
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        jsonFieldNames: ["googleIdToken"],
        hasGoogleIdToken: true,
        hasSignal: true,
        usesExpectedSignal: true,
      },
    ]);
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(JSON.stringify(fetch)).not.toContain("SECRET-GOOGLE-ID-TOKEN");
  });

  it.each(["", "   ", "x".repeat(16 * 1024 + 1)])(
    "rejects an invalid Google ID token before contacting Homegate",
    async (googleIdToken) => {
      const fetch = new SanitizedFetchRecorder();
      const client = new HomegateClient(HOMEGATE_BASE_URL, fetch.fetch);

      const result = await client.requestGoogleSignupInvitation(googleIdToken);

      expect(fetch.calls).toEqual([]);
      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("Expected invalid token failure.");
      expect(result.error).toEqual({ code: "homegate_invalid_request" });
    },
  );

  it.each(MALFORMED_SUCCESS_CASES)(
    "rejects a success response with %s",
    async (_name, response) => {
      const client = new HomegateClient(
        HOMEGATE_BASE_URL,
        new SanitizedFetchRecorder(response()).fetch,
      );

      const result = await client.requestGoogleSignupInvitation("id-token");

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("Expected malformed Homegate response failure.");
      expect(result.error).toMatchObject({
        code: "malformed_homegate_response",
        httpStatus: 200,
        cause: expect.any(Error),
      });
    },
  );

  it("maps an error-body stream failure to Homegate unavailable", async () => {
    const requestController = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(requestController.signal);
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("upstream body failed"));
        },
      }),
      { status: 500 },
    );
    const client = new HomegateClient(
      HOMEGATE_BASE_URL,
      new SanitizedFetchRecorder(response).fetch,
    );

    const result = await client.requestGoogleSignupInvitation("id-token");

    expect(requestController.signal.aborted).toBe(false);
    expect(Result.isError(result)).toBe(true);
    if (!Result.isError(result)) throw new Error("Expected unavailable Homegate failure.");
    expect(result.error).toMatchObject({
      code: "homegate_unavailable",
      httpStatus: 500,
      cause: expect.any(Error),
    });
  });

  it.each(HOMEGATE_ERROR_CASES)(
    "maps Homegate plaintext error %s to %s",
    async (body, expectedCode) => {
      const client = new HomegateClient(
        HOMEGATE_BASE_URL,
        new SanitizedFetchRecorder(new Response(body, { status: 500 })).fetch,
      );

      const result = await client.requestGoogleSignupInvitation("id-token");

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("Expected mapped Homegate failure.");
      expect(result.error).toMatchObject({
        code: expectedCode,
        httpStatus: 500,
        cause: expect.any(HttpResponseError),
      });
    },
  );

  it("logs an unknown Homegate body only as closed response metadata", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const client = new HomegateClient(
      HOMEGATE_BASE_URL,
      new SanitizedFetchRecorder(new Response("HOMEGATE-BODY-CANARY", { status: 500 })).fetch,
    );

    const result = await client.requestGoogleSignupInvitation("id-token");

    expect(Result.isError(result)).toBe(true);
    expect(warn).toHaveBeenCalledWith("identity.google.homeserver_signup_invitation.failed", {
      operation: "request_google_invitation",
      stage: "error_response",
      code: "malformed_homegate_response",
      httpStatus: 500,
      diagnosticId: expect.any(String),
      errorName: "HttpResponseError",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("HOMEGATE-BODY-CANARY");
  });

  it("maps absent and oversized Homegate error bodies to unavailable", async () => {
    for (const response of [
      new Response(null, { status: 500 }),
      new Response("x".repeat(257), { status: 500 }),
    ]) {
      const client = new HomegateClient(
        HOMEGATE_BASE_URL,
        new SanitizedFetchRecorder(response).fetch,
      );

      const result = await client.requestGoogleSignupInvitation("id-token");

      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("Expected unavailable Homegate failure.");
      expect(result.error).toMatchObject({
        code: "homegate_unavailable",
        httpStatus: 500,
        cause: expect.any(Error),
      });
    }
  });

  it("maps network failures without leaking the Google ID token", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new TypeError("SECRET-GOOGLE-ID-TOKEN");
    const fetch = new SanitizedFetchRecorder(cause);
    const client = new HomegateClient(HOMEGATE_BASE_URL, fetch.fetch);

    const result = await client.requestGoogleSignupInvitation("SECRET-GOOGLE-ID-TOKEN");

    expect(Result.isError(result)).toBe(true);
    if (!Result.isError(result)) throw new Error("Expected Homegate network failure.");
    expect(result.error.code).toBe("network_failed");
    expect(result.error.cause).toBe(cause);
    expect(warn).toHaveBeenCalledWith("identity.google.homeserver_signup_invitation.failed", {
      operation: "request_google_invitation",
      stage: "request",
      code: "network_failed",
      diagnosticId: expect.any(String),
      errorName: "TypeError",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-GOOGLE-ID-TOKEN");
    expect(JSON.stringify(fetch)).not.toContain("SECRET-GOOGLE-ID-TOKEN");
  });

  it("maps timeout setup failures to a network failure", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new DOMException("SECRET-HOMEGATE-URL", "NotSupportedError");
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      throw cause;
    });
    const fetch = new SanitizedFetchRecorder();
    const client = new HomegateClient(HOMEGATE_BASE_URL, fetch.fetch);

    const result = await client.requestGoogleSignupInvitation("id-token");

    expect(fetch.calls).toEqual([]);
    expect(Result.isError(result)).toBe(true);
    if (!Result.isError(result)) throw new Error("Expected Homegate network failure.");
    expect(result.error.code).toBe("network_failed");
    expect(result.error.cause).toBe(cause);
    expect(warn).toHaveBeenCalledWith("identity.google.homeserver_signup_invitation.failed", {
      operation: "request_google_invitation",
      stage: "request",
      code: "network_failed",
      diagnosticId: expect.any(String),
      errorName: "NotSupportedError",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-HOMEGATE-URL");
  });

  it("maps a timeout while reading the response body to a network failure", async () => {
    const requestController = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(requestController.signal);
    const fetch = new SanitizedFetchRecorder(
      (signal) =>
        new Response(
          new ReadableStream({
            start(controller) {
              signal?.addEventListener("abort", () => controller.error(new Error("timed out")));
            },
          }),
        ),
    );
    const client = new HomegateClient(HOMEGATE_BASE_URL, fetch.fetch);

    const resultPromise = client.requestGoogleSignupInvitation("id-token");
    requestController.abort();

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (!Result.isError(result)) throw new Error("Expected Homegate timeout failure.");
    expect(result.error).toMatchObject({
      code: "network_failed",
      httpStatus: 200,
      cause: expect.any(Error),
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type SafeFetchCall = {
  url: string;
  method: string | null;
  headerNames: string[];
  cache: RequestCache | null;
  credentials: RequestCredentials | null;
  redirect: RequestRedirect | null;
  referrerPolicy: ReferrerPolicy | null;
  jsonFieldNames: string[];
  hasGoogleIdToken: boolean;
  hasSignal: boolean;
  usesExpectedSignal: boolean | null;
};

class SanitizedFetchRecorder {
  calls: SafeFetchCall[] = [];

  constructor(
    private outcome: Response | Error | ((signal: AbortSignal | null) => Response) = new Error(
      "Unexpected fetch.",
    ),
    private expectedSignal: AbortSignal | null = null,
  ) {}

  fetch: typeof globalThis.fetch = async (input, init) => {
    const payload = parseJsonRecord(init?.body);
    const signal = init?.signal ?? null;
    this.calls.push({
      url: String(input),
      method: init?.method ?? null,
      headerNames: Array.from(new Headers(init?.headers).keys()).map(normalizeHeaderName).sort(),
      cache: init?.cache ?? null,
      credentials: init?.credentials ?? null,
      redirect: init?.redirect ?? null,
      referrerPolicy: init?.referrerPolicy ?? null,
      jsonFieldNames: payload ? Object.keys(payload).sort() : [],
      hasGoogleIdToken:
        typeof payload?.googleIdToken === "string" && payload.googleIdToken.length > 0,
      hasSignal: signal !== null,
      usesExpectedSignal: this.expectedSignal === null ? null : signal === this.expectedSignal,
    });

    if (this.outcome instanceof Error) throw this.outcome;
    return typeof this.outcome === "function" ? this.outcome(signal) : this.outcome;
  };
}

function parseJsonRecord(body: BodyInit | null | undefined): Record<string, unknown> | null {
  if (typeof body !== "string") return null;
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeHeaderName(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}
