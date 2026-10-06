// @vitest-environment node
import { validateCapabilities } from "@synonymdev/pubky";
import { expect, test } from "vitest";
import { capabilitiesMatch } from "./capabilitiesMatch.js";

test.each([
  ["", [], true],
  ["", [""], true],
  ["/pub/app/:rw", ["/pub/app/:wr"], true],
  ["/pub/app/:rw", ["/pub/app/:r", "/pub/app/:w"], true],
  ["/pub/app/:w,/pub/app/:r", ["/pub/app/:rw"], true],
  ["/pub/a/:r,/pub/b/:w", ["/pub/b/:w", "/pub/a/:r"], true],
  ["/pub/app/:r", ["/pub/app/:r", "/pub/app/:r"], true],
  ["/pub/app/:r", ["/pub/app/:rw"], false],
  ["/pub/app/:rw", ["/pub/app/:r"], false],
  ["/pub/app/:r", ["/pub/app/:r", "/pub/other/:r"], false],
  ["/pub/app/:r,/pub/other/:r", ["/pub/app/:r"], false],
  ["/pub/app/:r", ["/pub/app:r"], false],
  ["/pub/app:r", ["/pub/app/:r"], false],
  ["/pub/app/:r", ["/:r"], false],
  ["/pub/app/:r", [], false],
  ["", ["/pub/app/:r"], false],
  ["/pub/app/:r", ["/pub/app/:x"], false],
  ["/pub/app/:r", ["/pub//app/:r"], false],
  ["/pub/app/:r", ["/pub/app/../:r"], false],
  ["/pub/app/:r", ["/pub/App/:r"], false],
  ["/pub/caf\u00e9/:r", ["/pub/cafe\u0301/:r"], false],
  ["malformed", ["malformed"], false],
] as const)("compares %s with %j as %s using the installed SDK", (expected, granted, matches) => {
  expect(capabilitiesMatch(expected, granted, validateCapabilities)).toBe(matches);
});

test("a throwing normalization boundary never authenticates", () => {
  expect(
    capabilitiesMatch("", [], () => {
      throw new Error("private payload");
    }),
  ).toBe(false);
});
