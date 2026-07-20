import { describe, expect, it } from "vitest";

import { createRequestGoogleHomegateInviteUseCase } from "./requestGoogleHomegateInvite";
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

describe("requestGoogleHomegateInvite", () => {
  it("requests an invite from Homegate with the Google ID token", async () => {
    let receivedToken: string | undefined;
    const useCase = createRequestGoogleHomegateInviteUseCase({
      homegateInvite: homegateInvitePort((input) => {
        receivedToken = input.googleIdToken;
        return { ok: true, value: invite };
      }),
    });

    await expect(useCase({ googleIdToken: "google-id-token" })).resolves.toEqual({
      ok: true,
      invite,
    });
    expect(receivedToken).toBe("google-id-token");
  });

  it("rejects empty tokens before calling Homegate", async () => {
    let calls = 0;
    const useCase = createRequestGoogleHomegateInviteUseCase({
      homegateInvite: homegateInvitePort(() => {
        calls += 1;
        return { ok: true, value: invite };
      }),
    });

    await expect(useCase({ googleIdToken: "   " })).resolves.toEqual({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(calls).toBe(0);
  });

  it.each(homegateErrorCodes)("maps Homegate %s responses to safe application errors", async (code) => {
    const useCase = createRequestGoogleHomegateInviteUseCase({
      homegateInvite: homegateInvitePort(() => ({ ok: false, error: { code } })),
    });

    await expect(useCase({ googleIdToken: "google-id-token" })).resolves.toEqual({
      ok: false,
      error: { code },
    });
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

    expect(result).toEqual({ ok: false, error: { code: "dependency_unavailable" } });
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
