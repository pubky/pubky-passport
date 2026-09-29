import { expect, test } from "vitest";
import { validateRelay } from "./relayRules.js";
import { PassportConfigError } from "./PassportConfigError.js";

test("uses SDK default when absent and accepts HTTPS inbox paths", () => {
  expect(validateRelay(undefined)).toBeUndefined();
  expect(validateRelay("https://relay.example/inbox")).toBe("https://relay.example/inbox");
});
test.each([
  "",
  "relative",
  "http://relay.example/inbox",
  "https://user:pw@relay.example/inbox",
  "https://relay.example:8443/inbox",
  "https://relay.example/inbox#fragment",
  "https://relay.example/inbox#",
  "https://relay.example/link",
  "https://relay.example/link/",
  "https://relay.example/nested/link/",
  "https://bad_host/inbox",
  "https://relay.example/" + "a".repeat(2048),
  "https://relay.example/" + "é".repeat(500),
  "https://relay.example/#" + "private-" + "canary",
])("rejects incompatible relay %s", (input) => {
  try {
    validateRelay(input);
    expect.fail("accepted invalid relay");
  } catch (error) {
    expect(error).toBeInstanceOf(PassportConfigError);
    expect((error as PassportConfigError).issues[0]?.option).toBe("relay");
    if (input)
      expect(String(error) + JSON.stringify((error as PassportConfigError).issues)).not.toContain(
        input,
      );
  }
});
