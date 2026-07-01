import { describe, expect, it } from "vitest";

import { FakeHomegateInvite } from "./fakeHomegateInvite";

describe("Homegate invite fakes", () => {
  it("returns deterministic invite data without recording raw Google ID tokens", async () => {
    const homegate = new FakeHomegateInvite();

    await expect(homegate.requestGoogleInvite({ googleIdToken: "SECRET-GOOGLE-ID-TOKEN" })).resolves.toEqual({
      ok: true,
      value: homegate.invite,
    });
    expect(homegate.calls).toEqual([{ hasGoogleIdToken: true }]);
    expect(JSON.stringify(homegate.calls)).not.toContain("SECRET-GOOGLE-ID-TOKEN");
  });

  it("simulates expected Homegate invite failures", async () => {
    const homegate = new FakeHomegateInvite();
    homegate.failure = "weekly_limit_exceeded";

    await expect(homegate.requestGoogleInvite({ googleIdToken: "google-id-token" })).resolves.toEqual({
      ok: false,
      error: { code: "weekly_limit_exceeded" },
    });
  });
});
