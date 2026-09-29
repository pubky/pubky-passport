import { describe, expect, it } from "vitest";

import { describeBlockedMethods } from "./verificationAvailability";

describe("describeBlockedMethods", () => {
  it.each([
    [[], ["Lightning"], ""],
    [["SMS"], [], "SMS isn’t available in your country."],
    [
      ["SMS"],
      ["Lightning", "an invite code"],
      "SMS isn’t available in your country. You can use Lightning or an invite code.",
    ],
    [
      ["Lightning", "SMS"],
      ["an invite code"],
      "Lightning and SMS aren’t available in your country. You can use an invite code.",
    ],
  ])("describes %o blocked with %o left", (blocked, usable, sentence) => {
    expect(describeBlockedMethods(blocked, usable)).toBe(sentence);
  });
});
