import { describe, expect, it } from "vitest";

import { shortCopiedValue, shortPublicKey } from "./formatPublicKey";

describe("shortPublicKey", () => {
  it("keeps keys of up to twelve characters intact", () => {
    expect(shortPublicKey("abcdefghijkl")).toBe("abcdefghijkl");
  });

  it("elides the middle of longer keys", () => {
    expect(shortPublicKey("abcdefghijklm")).toBe("abcd...jklm");
  });
});

describe("shortCopiedValue", () => {
  it("keeps values of up to thirty-two characters intact", () => {
    const value = "a".repeat(32);
    expect(shortCopiedValue(value)).toBe(value);
  });

  it("truncates longer values after thirty-two characters", () => {
    expect(shortCopiedValue(`${"a".repeat(32)}b`)).toBe(`${"a".repeat(32)}...`);
  });
});
