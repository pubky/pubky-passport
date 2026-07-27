import { describe, expect, it } from "vitest";

import { decodeBase64Url, encodeBase64Url, isCanonicalBase64Url } from "./base64Url";

describe("Base64url encoding", () => {
  it("round-trips unpadded bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 252, 253, 254, 255]);
    const encoded = encodeBase64Url(bytes);

    expect(encoded).toBe("AAEC_P3-_w");
    expect(encoded).not.toContain("=");
    expect(decodeBase64Url(encoded)).toEqual(bytes);
  });

  it("round-trips empty bytes", () => {
    expect(encodeBase64Url(new Uint8Array())).toBe("");
    expect(decodeBase64Url("")).toEqual(new Uint8Array());
  });

  it("rejects malformed and padded values", () => {
    for (const value of ["abc+", "abc/", "abc=", "A"]) {
      expect(decodeBase64Url(value)).toBeUndefined();
    }
  });

  it("rejects non-canonical encodings", () => {
    expect(decodeBase64Url("AB")).toBeUndefined();
    expect(decodeBase64Url("AA")).toEqual(new Uint8Array([0]));
    expect(isCanonicalBase64Url("AB")).toBe(false);
    expect(isCanonicalBase64Url("AA")).toBe(true);
  });
});
