import { describe, expect, it } from "vitest";

import { identityDisplayName, profileName } from "./identityDisplay";

const KEY = "tkrq8zmwb8a3m9k15csu3q17qmfgqnp9dskbrg9uq1rydpyxp7qy";
const OTHER_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";

function identity(publicKeyZ32: string, name?: string) {
  return {
    publicIdentity: { publicKeyZ32 },
    ...(name === undefined ? {} : { profile: { name } }),
  };
}

describe("identityDisplayName", () => {
  it("uses the profile name", () => {
    expect(identityDisplayName(identity(KEY, "Satoshi"))).toBe("Satoshi");
  });

  it("names an identity without a profile after its own key, so two never read the same", () => {
    expect(identityDisplayName(identity(KEY))).toBe("Pubky tkrq…p7qy");
    expect(identityDisplayName(identity(OTHER_KEY))).toBe("Pubky 5jsj…tryo");
  });

  it("treats a blank profile name as none", () => {
    expect(identityDisplayName(identity(KEY, "   "))).toBe("Pubky tkrq…p7qy");
    expect(profileName(identity(KEY, "  "))).toBeUndefined();
    expect(profileName(identity(KEY, " Satoshi "))).toBe("Satoshi");
  });
});
