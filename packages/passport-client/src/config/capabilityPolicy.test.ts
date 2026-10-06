// @vitest-environment node
import { validateCapabilities } from "@synonymdev/pubky";
import { expect, test, vi } from "vitest";
import { resolveCapabilities } from "./capabilityPolicy.js";
import { PassportConfigError } from "./PassportConfigError.js";

test("allows identity-only and NFC-normalizes before the real SDK validator", () => {
  expect(resolveCapabilities("", validateCapabilities)).toBe("");
  const validate = vi.fn(validateCapabilities);
  expect(resolveCapabilities("/pub/cafe\u0301/:rw", validate)).toContain("/pub/café/");
  expect(validate).toHaveBeenCalledWith("/pub/café/:rw");
});
test.each(["/:rw", "/pub/:rw", "/priv/:rw", "/pub:rw", "/priv:r", "/pub/app/:r,/priv/:r"])(
  "rejects broad capability %s: least privilege, with no opt-in",
  (input) => {
    expect(() => resolveCapabilities(input, validateCapabilities)).toThrow(PassportConfigError);
  },
);
test.each([
  "/pub/pubky.app/:rw,/priv/social/:rw,/priv/app.locks/content/:r",
  "/priv/social/v1/:rw",
  "/priv/app/notes.json:r",
])("allows a namespace-scoped capability set %s", (input) => {
  expect(resolveCapabilities(input, validateCapabilities)).toBe(input);
});
test.each([
  "/pub/a/:x",
  "/pub/a/:r,",
  "/pub/a//b:r",
  "/pub/../a:r",
  "/pub/a\u202e/:r",
  Array(65).fill("/pub/a/:r").join(","),
  "/" + Array(4).fill("a".repeat(243)).join("/") + ":r",
  "/pub/a/:" + "r".repeat(1024),
])("rejects SDK-invalid or over-limit capabilities %j", (input) => {
  expect(() => resolveCapabilities(input, validateCapabilities)).toThrow(PassportConfigError);
});
test("does not keep an SDK error or its message", () => {
  const canary = "sensitive-" + "capability";
  try {
    resolveCapabilities("/pub/a/:r", () => {
      throw new Error(canary);
    });
    expect.fail("accepted SDK failure");
  } catch (e) {
    expect(e).toBeInstanceOf(PassportConfigError);
    expect(String(e)).not.toContain(canary);
    expect(JSON.stringify(e)).not.toContain(canary);
  }
});
test.each(["/pub/x", "/a", "//"])(
  "does not recommend broad scopes for missing actions: %s",
  (input) => {
    try {
      resolveCapabilities(input, validateCapabilities);
      expect.fail("accepted missing actions");
    } catch (error) {
      expect(error).toBeInstanceOf(PassportConfigError);
      expect((error as PassportConfigError).issues[0]?.message).toBe(
        "Use valid, bounded Pubky capabilities.",
      );
    }
  },
);
