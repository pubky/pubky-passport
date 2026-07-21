import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import {
  createRequestGoogleHomegateInviteController,
} from "./requestGoogleHomegateInviteController";
import type {
  RequestGoogleHomegateInviteErrorCode,
  RequestGoogleHomegateInviteUseCase,
} from "./requestGoogleHomegateInvite";

const invite = {
  signupCode: "signup-code",
  homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
};

const errorStatusCases: Array<{
  code: RequestGoogleHomegateInviteErrorCode;
  status: number;
}> = [
  { code: "invalid_request", status: 400 },
  { code: "invalid_google_id_token", status: 401 },
  { code: "weekly_limit_exceeded", status: 429 },
  { code: "annual_limit_exceeded", status: 429 },
  { code: "homegate_invalid_request", status: 502 },
  { code: "malformed_homegate_response", status: 502 },
  { code: "homeserver_unavailable", status: 503 },
  { code: "google_verifier_unavailable", status: 503 },
  { code: "homegate_unavailable", status: 503 },
  { code: "dependency_unavailable", status: 503 },
];

describe("requestGoogleHomegateInviteController", () => {
  it("maps successful invite requests to safe response bodies", async () => {
    const controller = createRequestGoogleHomegateInviteController(useCase(async () => Result.ok(invite)));

    await expect(controller({ googleIdToken: "google-id-token" })).resolves.toEqual({
      status: 200,
      body: invite,
    });
  });

  it.each(errorStatusCases)("maps $code to HTTP $status", async ({ code, status }) => {
    const controller = createRequestGoogleHomegateInviteController(
      useCase(async () => Result.err({ code })),
    );

    await expect(controller({ googleIdToken: "google-id-token" })).resolves.toEqual({
      status,
      body: { error: { code } },
    });
  });

  it("does not include token or invite values in error responses", async () => {
    const controller = createRequestGoogleHomegateInviteController(
      useCase(async () => Result.err({ code: "homegate_unavailable" })),
    );

    const result = await controller({ googleIdToken: "SECRET-GOOGLE-ID-TOKEN" });

    expect(result).toEqual({ status: 503, body: { error: { code: "homegate_unavailable" } } });
    expect(JSON.stringify(result)).not.toContain("SECRET-GOOGLE-ID-TOKEN");
    expect(JSON.stringify(result)).not.toContain("signup-code");
  });
});

function useCase(
  request: RequestGoogleHomegateInviteUseCase,
): RequestGoogleHomegateInviteUseCase {
  return request;
}
