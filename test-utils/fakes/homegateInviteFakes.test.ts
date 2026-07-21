import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { expectAsyncResultError } from "../resultAssertions";
import { FakeHomegateInvite } from "./fakeHomegateInvite";

describe("Homegate invite fakes", () => {
  it("returns deterministic invite data without recording raw Google ID tokens", async () => {
    const homegate = new FakeHomegateInvite();

    await expect(homegate.requestSignupInvitation({ googleIdToken: "SECRET-GOOGLE-ID-TOKEN" })).resolves.toEqual(Result.ok(homegate.invite));
    expect(homegate.calls).toEqual([{ hasGoogleIdToken: true }]);
    expect(JSON.stringify(homegate.calls)).not.toContain("SECRET-GOOGLE-ID-TOKEN");
  });

  it("simulates expected Homegate invite failures", async () => {
    const homegate = new FakeHomegateInvite();
    homegate.failure = "weekly_limit_exceeded";

    await expectAsyncResultError(
      homegate.requestSignupInvitation({ googleIdToken: "google-id-token" }),
      { code: "weekly_limit_exceeded" },
    );
  });
});
