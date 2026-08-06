import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { parseGoogleAuthorizationCode } from "./routePolicy";

describe("Google authorization route policy", () => {
  it("accepts a bounded same-origin code request", async () => {
    await expect(parseGoogleAuthorizationCode(request({ body: { code: "one-time-code" } }))).resolves.toEqual(Result.ok("one-time-code"));
  });

  it.each([
    { origin: "https://attacker.example" },
    { requestedWith: "" },
    { contentType: "text/plain" },
    { body: { code: "code", extra: true } },
    { body: { code: "" } },
  ])("rejects malformed or cross-origin requests", async (input) => {
    const result = await parseGoogleAuthorizationCode(request(input));
    expect(Result.isError(result)).toBe(true);
  });
});

function request(input: { body?: unknown; contentType?: string; origin?: string; requestedWith?: string } = {}): Request {
  return new Request("https://passport.example/api/google/authorize", {
    method: "POST",
    headers: {
      "Content-Type": input.contentType ?? "application/json",
      "Origin": input.origin ?? "https://passport.example",
      "X-Requested-With": input.requestedWith ?? "XmlHttpRequest",
    },
    body: JSON.stringify(input.body ?? { code: "one-time-code" }),
  });
}
