import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { expectAsyncResultError } from "../../../../test-utils/resultAssertions";
import {
  createRequestGoogleHomegateInviteUseCase,
  type RequestGoogleHomegateInviteResult,
} from "./requestGoogleHomegateInvite";
import type {
  GoogleHomegateInviteErrorCode,
  GoogleHomegateInvitePort,
  GoogleHomegateInviteResult,
  HomeserverSignupInvitation,
} from "../../ports/homegateInvite";

const invite: HomeserverSignupInvitation = {
  signupCode: "signup-code",
  homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
};

const homegateErrorCodes: GoogleHomegateInviteErrorCode[] = [
  "invalid_google_id_token",
  "weekly_limit_exceeded",
  "annual_limit_exceeded",
  "homegate_invalid_request",
  "homeserver_unavailable",
  "google_verifier_unavailable",
  "homegate_unavailable",
  "malformed_homegate_response",
];

async function expectError(result: Promise<RequestGoogleHomegateInviteResult>, code: string): Promise<void> {
  await expectAsyncResultError(result, { code });
}

describe("requestGoogleHomegateInvite", () => {
  it("requests an invite from Homegate with the Google ID token", async () => {
    let receivedToken: string | undefined;
    const useCase = createRequestGoogleHomegateInviteUseCase({
      homegateInvite: homegateInvitePort((input) => {
        receivedToken = input.googleIdToken;
        return Result.ok(invite);
      }),
    });

    await expect(useCase({ googleIdToken: "google-id-token" })).resolves.toEqual(Result.ok(invite));
    expect(receivedToken).toBe("google-id-token");
  });

  it("rejects empty tokens before calling Homegate", async () => {
    let calls = 0;
    const useCase = createRequestGoogleHomegateInviteUseCase({
      homegateInvite: homegateInvitePort(() => {
        calls += 1;
        return Result.ok(invite);
      }),
    });

    await expectError(useCase({ googleIdToken: "   " }), "invalid_request");
    expect(calls).toBe(0);
  });

  it.each(homegateErrorCodes)("maps Homegate %s responses to safe application errors", async (code) => {
    const useCase = createRequestGoogleHomegateInviteUseCase({
      homegateInvite: homegateInvitePort(() => Result.err({ code })),
    });

    await expectError(useCase({ googleIdToken: "google-id-token" }), code);
  });

  it("maps thrown Homegate dependencies to safe errors", async () => {
    const useCase = createRequestGoogleHomegateInviteUseCase({
      homegateInvite: {
        async requestInvite() {
          throw new Error("google-id-token and signup-code must not leak");
        },
      },
    });

    const result = await useCase({ googleIdToken: "google-id-token" });

    await expectError(Promise.resolve(result), "dependency_unavailable");
    expect(JSON.stringify(result)).not.toContain("google-id-token");
    expect(JSON.stringify(result)).not.toContain("signup-code");
  });
});

function homegateInvitePort(
  requestInvite: (input: { googleIdToken: string }) => GoogleHomegateInviteResult,
): GoogleHomegateInvitePort {
  return {
    async requestInvite(input) {
      return requestInvite(input);
    },
  };
}
