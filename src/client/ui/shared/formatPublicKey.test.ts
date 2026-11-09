import { describe, expect, it } from "vitest";

import { shortPublicKey } from "./formatPublicKey";

describe("shortPublicKey", () => {
  it("keeps keys of up to twelve characters intact", () => {
    expect(shortPublicKey("abcdefghijkl")).toBe("abcdefghijkl");
  });

  it("elides the middle of longer keys with one ellipsis character, keeping their case", () => {
    expect(shortPublicKey("abcdefghijklm")).toBe("abcd…jklm");
  });
});
