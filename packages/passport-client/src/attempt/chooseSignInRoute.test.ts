// @vitest-environment node
import { expect, test } from "vitest";
import { chooseSignInRoute, chooseBlockedPopupRoute } from "./chooseSignInRoute.js";
import type { BrowserEnvironment } from "../environment/browserEnvironment.js";

const regular: BrowserEnvironment = Object.freeze({
  topLevel: true,
  protocol: "https:",
  storageWritable: true,
  inApp: false,
  iosStandalone: false,
  crossOriginIsolated: false,
});

test.each([
  ["an ordinary browser opens a popup", {}, { kind: "popup" }],
  [
    "an in-app browser goes to the same tab",
    { inApp: true },
    { kind: "redirect", cause: "preferred" },
  ],
  [
    "an iOS home-screen app goes to the same tab",
    { iosStandalone: true },
    { kind: "redirect", cause: "preferred" },
  ],
  [
    "a cross-origin-isolated page goes to the same tab with a diagnostic",
    { crossOriginIsolated: true },
    { kind: "redirect", cause: "preferred", diagnostic: "cross_origin_isolated" },
  ],
  [
    "a frame keeps the popup whatever the hints",
    { topLevel: false, inApp: true, crossOriginIsolated: true },
    { kind: "popup" },
  ],
  [
    "HTTP keeps an in-app browser on the popup",
    { protocol: "http:", inApp: true },
    { kind: "popup" },
  ],
  [
    "blocked storage keeps an isolated page on the popup",
    { storageWritable: false, crossOriginIsolated: true },
    { kind: "popup" },
  ],
  [
    "blocked storage keeps an iOS home-screen app on the popup",
    { storageWritable: false, iosStandalone: true },
    { kind: "popup" },
  ],
] as const)("%s", (_description, overrides, expected) => {
  expect(chooseSignInRoute(Object.freeze({ ...regular, ...overrides }))).toEqual(expected);
});

test("a blocked popup continues in this tab", () => {
  expect(chooseBlockedPopupRoute(regular)).toEqual({ kind: "redirect", cause: "blocked" });
});

test("a blocked popup in a frame cannot continue in this tab", () => {
  expect(chooseBlockedPopupRoute({ ...regular, topLevel: false })).toEqual({
    kind: "failed",
    code: "unsupported_environment",
  });
});

test.each([[{ protocol: "http:" }], [{ storageWritable: false }]] as const)(
  "a blocked popup without same-tab prerequisites %j fails with a diagnostic",
  (overrides) => {
    expect(chooseBlockedPopupRoute({ ...regular, ...overrides })).toEqual({
      kind: "failed",
      code: "popup_blocked",
      diagnostic: "redirect_unavailable",
    });
  },
);
