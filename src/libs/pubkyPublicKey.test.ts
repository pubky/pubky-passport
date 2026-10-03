import { describe, expect, it } from "vitest";

import { isCanonicalPubkyPublicKey } from "./pubkyPublicKey";

describe("isCanonicalPubkyPublicKey", () => {
  it("accepts a canonical z-base-32 public key", () => {
    expect(isCanonicalPubkyPublicKey("ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy")).toBe(
      true,
    );
  });

  it.each([
    ["a non-string", 52],
    ["a wrong length", "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1u"],
    ["a character outside z-base-32", "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1ul"],
    ["an uppercase key", "UFIBWBMED6JEQ9K4P583GO95WOFAKH9FWPP4K734TRQ79PD9U1UY"],
    ["non-canonical trailing bits", "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1ub"],
  ])("rejects %s", (_, value) => {
    expect(isCanonicalPubkyPublicKey(value)).toBe(false);
  });
});
