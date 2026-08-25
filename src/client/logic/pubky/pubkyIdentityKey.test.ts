import { describe, expect, it } from "vitest";

import { isPubkyPublicIdentity } from "./pubkyIdentityKey";

const PUBLIC_KEY_Z32 = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const PUBLIC_IDENTITY = {
  publicKeyZ32: PUBLIC_KEY_Z32,
  publicKeyDisplay: `pubky${PUBLIC_KEY_Z32}`,
};

describe("isPubkyPublicIdentity", () => {
  it("accepts matching canonical key forms", () => {
    expect(isPubkyPublicIdentity(PUBLIC_IDENTITY)).toBe(true);
  });

  it.each([
    ["malformed z32", { ...PUBLIC_IDENTITY, publicKeyZ32: "not-a-pubky" }],
    ["mismatched display", { ...PUBLIC_IDENTITY, publicKeyDisplay: `pubky${"y".repeat(52)}` }],
    ["undeclared fields", { ...PUBLIC_IDENTITY, source: "test" }],
  ])("rejects %s", (_case, identity) => {
    expect(isPubkyPublicIdentity(identity)).toBe(false);
  });
});
