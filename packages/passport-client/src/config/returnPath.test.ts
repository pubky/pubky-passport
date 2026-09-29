import { expect, test } from "vitest";
import { resolveReturnPath, buildReturnCallbacks } from "./returnPath.js";
import { PassportConfigError } from "./PassportConfigError.js";
const page = { origin: "https://app.example", pathname: "/here" };

test.each(["/", "/app/return", "/%7Euser/"])("preserves accepted path %s", (path) => {
  expect(resolveReturnPath(path, page)).toBe(path);
});
test("defaults to the current pathname without search or fragment", () => {
  expect(resolveReturnPath(undefined, page)).toBe("/here");
});
test.each([
  ".evil.com/",
  "@evil.com/",
  ":8443/",
  "//evil.com/",
  "/\\evil.com",
  "\\evil.com",
  "/a\\b",
  "/a?x",
  "/a#x",
  "/a\u0001b",
  "",
  "/a/../b",
  "/a/%2e%2e/b",
  "/a b",
  "/return?" + "private-" + "canary",
])("rejects an unsafe or silently changed path %j", (path) => {
  try {
    resolveReturnPath(path, page);
    expect.fail("accepted unsafe path");
  } catch (error) {
    expect(error).toBeInstanceOf(PassportConfigError);
    expect((error as PassportConfigError).issues[0]?.option).toBe("returnPath");
    if (path)
      expect(String(error) + JSON.stringify((error as PassportConfigError).issues)).not.toContain(
        path,
      );
  }
});
test("rejects an opaque browser origin with a returnPath issue", () => {
  try {
    resolveReturnPath("/", { origin: "null", pathname: "/" });
    expect.fail("accepted opaque origin");
  } catch (error) {
    expect(error).toBeInstanceOf(PassportConfigError);
    expect((error as PassportConfigError).issues[0]?.option).toBe("returnPath");
  }
});
test("builds all three callbacks with URL search and a bound attempt", () => {
  const callbacks = buildReturnCallbacks("/app/return", page, "A".repeat(22));
  for (const [key, kind] of [
    ["xSuccess", "s"],
    ["xError", "e"],
    ["xCancel", "c"],
  ] as const) {
    const url = new URL(callbacks[key]);
    expect(url.origin).toBe(page.origin);
    expect(url.pathname).toBe("/app/return");
    expect(url.searchParams.get("pubky-passport")).toBe(`${kind}.${"A".repeat(22)}`);
  }
});
