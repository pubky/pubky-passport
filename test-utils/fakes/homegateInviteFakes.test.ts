import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { FakeHomegateInvite } from "./fakeHomegateInvite";

describe("Homegate invite fakes", () => {
  it("returns deterministic invite data without recording raw Google ID tokens", async () => {
    const homegate = new FakeHomegateInvite();

    const result = await homegate.requestGoogleInvite({ googleIdToken: "SECRET-GOOGLE-ID-TOKEN" });
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value).toEqual(homegate.invite);
    }
    expect(homegate.calls).toEqual([{ hasGoogleIdToken: true }]);
    expect(JSON.stringify(homegate.calls)).not.toContain("SECRET-GOOGLE-ID-TOKEN");
  });

  it("simulates expected Homegate invite failures", async () => {
    const homegate = new FakeHomegateInvite();
    homegate.failure = "weekly_limit_exceeded";

    const result = await homegate.requestGoogleInvite({ googleIdToken: "google-id-token" });
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({ code: "weekly_limit_exceeded" });
    }
  });
});
