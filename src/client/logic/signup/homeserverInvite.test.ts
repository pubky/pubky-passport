import { describe, expect, it } from "vitest";

import { parseInviteCode, sameInvite, signupTokenSchema } from "./homeserverInvite";

const HOMESERVER = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";

describe("homeserver invites", () => {
  it.each([
    ["AB12-CD34-EF56", "AB12-CD34-EF56"],
    ["  ab12-cd34-ef56 ", "AB12-CD34-EF56"],
    ["0000-ZZZZ-9999", "0000-ZZZZ-9999"],
  ])("accepts the homeserver token format %j", (value, expected) => {
    expect(parseInviteCode(value)).toBe(expected);
  });

  it.each([
    "",
    "ABCD",
    "ABCD-",
    "single-use-invite",
    "AB12CD34EF56",
    "AB12-CD34-EF5",
    "AB12-CD34-EF567",
    // Crockford base32 has no I, L, O, or U.
    "AB1I-CD34-EF56",
    "ABLO-CD34-EF56",
    "ABCU-CD34-EF56",
  ])("rejects %j before any homeserver lookup", (value) => {
    expect(parseInviteCode(value)).toBeNull();
  });

  it("bounds signup tokens without accepting blank ones", () => {
    expect(signupTokenSchema.safeParse("token").success).toBe(true);
    expect(signupTokenSchema.safeParse("   ").success).toBe(false);
    expect(signupTokenSchema.safeParse("x".repeat(1025)).success).toBe(false);
  });

  it("compares both the token and its homeserver", () => {
    const invite = { signupToken: "AB12-CD34-EF56", homeserverPubky: HOMESERVER };
    expect(sameInvite(invite, { ...invite })).toBe(true);
    expect(sameInvite(invite, { ...invite, signupToken: "AB12-CD34-EF57" })).toBe(false);
    expect(sameInvite(invite, { ...invite, homeserverPubky: "other" })).toBe(false);
  });
});
