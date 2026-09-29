import { expect, test } from "vitest";
import { resolveAppName, validateClientId } from "./appNameRules.js";
import { PassportConfigError } from "./PassportConfigError.js";

test("normalizes and trims app names with the Passport bounds", () => {
  expect(resolveAppName("  Cafe\u0301  ")).toBe("Café");
  expect(resolveAppName("a".repeat(128))).toHaveLength(128);
});
test.each([
  "",
  "   ",
  "a".repeat(129),
  "ab\u0000cd",
  "ab\u007fcd",
  "ab\u2028cd",
  "ab\u202ecd",
  "ab\u200bcd",
  "ab\u2060cd",
  "ab\ufeffcd",
])("rejects invalid app name %j without echoing it", (input) => {
  try {
    resolveAppName(input);
    expect.fail("accepted invalid name");
  } catch (e) {
    expect(e).toBeInstanceOf(PassportConfigError);
    expect((e as PassportConfigError).issues[0]?.option).toBe("appName");
    if (input.trim())
      expect(String(e) + JSON.stringify((e as PassportConfigError).issues)).not.toContain(input);
  }
});
test.each(["ab\u200ccd", "👩‍💻 Notes"])("accepts Passport-supported joiners in %s", (input) => {
  expect(resolveAppName(input)).toBe(input);
});
test("bounds client ID by UTF-8 bytes without changing its value", () => {
  expect(validateClientId("a".repeat(253))).toHaveLength(253);
  expect(validateClientId("é".repeat(126))).toBe("é".repeat(126));
  expect(() => validateClientId("é".repeat(127))).toThrow(PassportConfigError);
  expect(() => validateClientId("")).toThrow(PassportConfigError);
});
