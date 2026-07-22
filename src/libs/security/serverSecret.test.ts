import { describe, expect, it } from "vitest";

import { hasMinimumServerSecretBytes, isBase64, minimumServerSecretByteLength } from "./serverSecret";

describe("server secret validation", () => {
  it("accepts padded standard base64 and rejects invalid forms", () => {
    expect(isBase64(Buffer.alloc(32, 255).toString("base64"))).toBe(true);
    expect(isBase64("not-base64!")).toBe(false);
    expect(isBase64("base64url_value")).toBe(false);
  });

  it("requires at least 32 decoded bytes", () => {
    expect(minimumServerSecretByteLength()).toBe(32);
    expect(hasMinimumServerSecretBytes(Buffer.alloc(31))).toBe(false);
    expect(hasMinimumServerSecretBytes(Buffer.alloc(32))).toBe(true);
  });
});
