// @vitest-environment node
import { validateCapabilities } from "@synonymdev/pubky";
import { expect, test } from "vitest";
import { resolveClientOptions, resolveBrowserOptions } from "./resolveClientOptions.js";
import { PassportConfigError } from "./PassportConfigError.js";

test("resolves every zero-option default without browser globals or creating an SDK", () => {
  const options = resolveClientOptions(undefined, validateCapabilities);
  expect(options).toMatchObject({
    capabilities: "",
    profile: "required" as const,
    instance: "https://passport.pubky.app",
    timeouts: {
      handshakeHintMs: 15000,
      closedGraceMs: 2500,
      ringGraceMs: 90000,
      detachedMs: 600000,
      finishingMs: 60000,
      attemptMs: 1800000,
      ringLinkRotateMs: 300000,
    },
  });
  expect(options.pubky).toBeUndefined();
  expect(options.appName).toBeUndefined();
  expect(options.clientId).toBeUndefined();
  expect(resolveBrowserOptions(options, { hostname: "app.example" })).toMatchObject({
    appName: "app.example",
    clientId: "app.example",
  });
});

test("validates explicit names at construction and browser-dependent defaults on first use", () => {
  expect(() => resolveClientOptions({ appName: "" }, validateCapabilities)).toThrow(
    PassportConfigError,
  );
  expect(() =>
    resolveBrowserOptions(resolveClientOptions(undefined, validateCapabilities), { hostname: "" }),
  ).toThrow(PassportConfigError);
});

test("keeps flat overrides and copies mutable option containers", () => {
  const source = {
    profile: "optional" as const,
    appName: " App ",
    clientId: "client",
    capabilities: "/pub/app/:rw",
    timeouts: { attemptMs: 5000 },
    development: { allowLoopbackInstance: true },
  };
  const options = resolveClientOptions(source, validateCapabilities);
  source.timeouts.attemptMs = 1000;
  expect(options).toMatchObject({
    appName: "App",
    clientId: "client",
    profile: "optional" as const,
  });
  expect(options.timeouts.attemptMs).toBe(5000);
});

test.each([0, -1, 0.5, NaN, Infinity, 2 ** 31])("rejects invalid timeout %s", (value) => {
  expect(() =>
    resolveClientOptions({ timeouts: { attemptMs: value } }, validateCapabilities),
  ).toThrow(PassportConfigError);
});
test("accepts the supplied timeout boundary values", () => {
  expect(
    resolveClientOptions({ timeouts: { attemptMs: 1 } }, validateCapabilities).timeouts.attemptMs,
  ).toBe(1);
  expect(
    resolveClientOptions({ timeouts: { attemptMs: 2 ** 31 - 1 } }, validateCapabilities).timeouts
      .attemptMs,
  ).toBe(2 ** 31 - 1);
});
test("turns JavaScript option type errors into safe configuration issues", () => {
  for (const input of [
    { appName: 123 },
    { profile: "sometimes" },
    { profile: true },
    { onDiagnostic: true },
    { timeouts: 5 },
    { timeouts: null },
    { timeouts: [] },
    { development: "yes" },
    { development: [] },
    { development: { allowLoopbackInstance: "false" } },
    { development: { openWindow: 5 } },
    { messages: 5 },
    { messages: null },
    { messages: [] },
    { pubky: 5 },
    { pubky: null },
    { pubky: [] },
  ]) {
    expect(configError(input).issues[0]?.option).toBe(Object.keys(input)[0]);
  }
});

function configError(input: unknown): PassportConfigError {
  try {
    resolveClientOptions(input as never, validateCapabilities);
    expect.fail("accepted invalid options");
  } catch (error) {
    expect(error).toBeInstanceOf(PassportConfigError);
    return error as PassportConfigError;
  }
}

test("applies client ID and least-privilege capability rules during construction", () => {
  expect(configError({ clientId: "é".repeat(127) }).issues[0]?.option).toBe("clientId");
  expect(configError({ capabilities: "/:rw" }).issues[0]?.option).toBe("capabilities");
  // Options that were never public are unknown, so they cannot widen anything.
  expect(
    resolveClientOptions(
      { capabilities: "/pub/app/:rw", allowBroadCapabilities: true } as never,
      validateCapabilities,
    ).capabilities,
  ).toBe("/pub/app/:rw");
});

test("copies and freezes message overrides", () => {
  const messages = { "label.idle": "Continue" };
  const options = resolveClientOptions({ messages }, validateCapabilities);
  messages["label.idle"] = "Changed";
  expect(options.messages?.["label.idle"]).toBe("Continue");
  expect(Object.isFrozen(options.messages)).toBe(true);
});

test("treats null options as defaults and rejects other non-object containers safely", () => {
  expect(resolveClientOptions(null as never, validateCapabilities)).toEqual(
    resolveClientOptions(undefined, validateCapabilities),
  );
  for (const input of ["x", 5, false, []])
    expect(configError(input).message).toContain("options object");
});

test("uses defaults for explicit undefined timeout values", () => {
  expect(
    resolveClientOptions({ timeouts: { attemptMs: undefined } } as never, validateCapabilities)
      .timeouts.attemptMs,
  ).toBe(1_800_000);
  // The same-tab state's thirty minutes are fixed: no option names them any more.
  expect(configError({ timeouts: { redirectStateTtlMs: 5000 } }).issues[0]?.option).toBe(
    "timeouts",
  );
});

test("rejects unknown timeout keys without echoing them and names invalid known keys", () => {
  const canary = "atempt" + "Ms-private";
  const error = configError({ timeouts: { [canary]: 5000 } });
  expect(error.issues[0]?.option).toBe("timeouts");
  expect(String(error) + JSON.stringify(error.issues)).not.toContain(canary);
  expect(configError({ timeouts: { attemptMs: 0 } }).message).toContain("attemptMs");
});

test("configuration messages identify the option without exposing its input", () => {
  const canary = "ab" + "\u202e" + "private-canary";
  const error = configError({ appName: canary });
  expect(error.message).toContain("appName");
  expect(String(error) + JSON.stringify(error.issues)).not.toContain(canary);
});

test("normalizes the default origin at construction", () => {
  expect(
    resolveClientOptions({ instance: "PASSPORT.example:443/" }, validateCapabilities).instance,
  ).toBe("https://passport.example");
  expect(
    resolveClientOptions({ instance: "pässport.example:8443" }, validateCapabilities).instance,
  ).toBe("https://xn--pssport-5wa.example:8443");
});
test.each([
  ["http://custom.example", "Use HTTPS for the Passport origin.", false],
  ["https://localhost", "Use a domain origin without IP or localhost addresses.", true],
  ["https://127.0.0.1", "Use a domain origin without IP or localhost addresses.", true],
  ["https://user@custom.example", "Passport origins must not contain credentials.", false],
  [
    "https://custom.example/path",
    "Passport origins must not contain a path, query or fragment.",
    false,
  ],
  ["https://*.example", "Use a valid HTTPS Passport origin.", false],
] as const)("rejects an invalid default before browser use: %s", (input, message, loopback) => {
  expect(configError({ instance: input }).issues[0]).toEqual({
    option: "instance",
    code: "invalid_value",
    message: loopback
      ? "Use a Passport on an HTTPS domain, not localhost or an IP address."
      : message,
  });
});
test("allows exact loopback only for an explicitly enabled developer default", () => {
  expect(
    resolveClientOptions(
      { instance: "http://localhost:3001", development: { allowLoopbackInstance: true } },
      validateCapabilities,
    ).instance,
  ).toBe("http://localhost:3001");
  expect(
    configError({
      instance: "http://localhost.evil.example:3001",
      development: { allowLoopbackInstance: true },
    }).issues[0]?.option,
  ).toBe("instance");
});

test("explains the development flag without echoing the loopback input", () => {
  expect(configError({ instance: "http://localhost:3001" }).issues[0]).toEqual({
    option: "instance",
    code: "invalid_value",
    message: "Use a Passport on an HTTPS domain, not localhost or an IP address.",
  });
});
