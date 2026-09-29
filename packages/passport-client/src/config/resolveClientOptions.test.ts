// @vitest-environment node
import { validateCapabilities } from "@synonymdev/pubky";
import { expect, test } from "vitest";
import { resolveClientOptions, resolveBrowserOptions } from "./resolveClientOptions.js";
import { PassportConfigError } from "./PassportConfigError.js";

test("resolves every zero-option default without browser globals or creating an SDK", () => {
  const options = resolveClientOptions(undefined, validateCapabilities);
  expect(options).toMatchObject({
    capabilities: "",
    requireProfile: true,
    instance: "https://passport.pubky.app",
    allowCustomInstance: true,
    popupBlocked: "redirect",
    allowLocalRedirectState: false,
    allowBroadCapabilities: false,
    timeouts: {
      handshakeHintMs: 15000,
      closedGraceMs: 2500,
      ringGraceMs: 90000,
      detachedMs: 600000,
      finishingMs: 60000,
      attemptMs: 1800000,
      ringLinkRotateMs: 300000,
      redirectStateTtlMs: 1800000,
    },
  });
  expect(options.pubky).toBeUndefined();
  expect(options.relay).toBeUndefined();
  expect(options.appName).toBeUndefined();
  expect(options.clientId).toBeUndefined();
  expect(options.returnPath).toBeUndefined();
  expect(
    resolveBrowserOptions(options, {
      hostname: "app.example",
      origin: "https://app.example",
      pathname: "/start",
    }),
  ).toMatchObject({ appName: "app.example", clientId: "app.example", returnPath: "/start" });
});

test("validates explicit names at construction and browser-dependent defaults on first use", () => {
  expect(() => resolveClientOptions({ appName: "" }, validateCapabilities)).toThrow(
    PassportConfigError,
  );
  const options = resolveClientOptions({ returnPath: "//evil.example" }, validateCapabilities);
  expect(() =>
    resolveBrowserOptions(options, {
      hostname: "app.example",
      origin: "https://app.example",
      pathname: "/",
    }),
  ).toThrow(PassportConfigError);
  expect(() =>
    resolveBrowserOptions(resolveClientOptions(undefined, validateCapabilities), {
      hostname: "",
      origin: "null",
      pathname: "/",
    }),
  ).toThrow(PassportConfigError);
});

test("keeps flat overrides and copies mutable option containers", () => {
  const source = {
    requireProfile: false,
    appName: " App ",
    clientId: "client",
    capabilities: "/pub/app/:rw",
    popupBlocked: "prompt" as const,
    allowCustomInstance: false,
    allowLocalRedirectState: true,
    timeouts: { attemptMs: 5000 },
    development: { allowLoopbackInstance: true },
    allowedInstances: ["https://one.example"],
  };
  const options = resolveClientOptions(source, validateCapabilities);
  source.timeouts.attemptMs = 1000;
  source.allowedInstances.push("https://two.example");
  expect(options).toMatchObject({
    appName: "App",
    clientId: "client",
    requireProfile: false,
    popupBlocked: "prompt",
    allowCustomInstance: false,
    allowLocalRedirectState: true,
  });
  expect(options.timeouts.attemptMs).toBe(5000);
  expect(options.allowedInstances).toEqual(["https://one.example"]);
});

test("automatically bounds the default redirect TTL by a shortened attempt", () => {
  expect(
    resolveClientOptions({ timeouts: { attemptMs: 5000 } }, validateCapabilities).timeouts
      .redirectStateTtlMs,
  ).toBe(5000);
  expect(
    resolveClientOptions({ timeouts: { attemptMs: 2000000 } }, validateCapabilities).timeouts
      .redirectStateTtlMs,
  ).toBe(1800000);
});
test("rejects only an explicitly oversized redirect TTL", () => {
  expect(() =>
    resolveClientOptions(
      { timeouts: { attemptMs: 5000, redirectStateTtlMs: 5001 } },
      validateCapabilities,
    ),
  ).toThrow(PassportConfigError);
  expect(
    resolveClientOptions(
      { timeouts: { attemptMs: 5000, redirectStateTtlMs: 4000 } },
      validateCapabilities,
    ).timeouts.redirectStateTtlMs,
  ).toBe(4000);
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
    { requireProfile: "false" },
    { popupBlocked: "no" },
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
    { allowedInstances: "https://a.example" },
    { allowedInstances: [5] },
    { pubky: 5 },
    { pubky: null },
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

test("applies relay, client ID and broad-scope rules during construction", () => {
  expect(configError({ relay: "http://r.example/inbox" }).issues[0]?.option).toBe("relay");
  expect(
    resolveClientOptions({ relay: "https://r.example/inbox" }, validateCapabilities).relay,
  ).toBe("https://r.example/inbox");
  expect(configError({ clientId: "é".repeat(127) }).issues[0]?.option).toBe("clientId");
  expect(configError({ capabilities: "/:rw" }).issues[0]?.option).toBe("capabilities");
  expect(
    resolveClientOptions(
      { capabilities: "/:rw", allowBroadCapabilities: true },
      validateCapabilities,
    ).capabilities,
  ).toBe("/:rw");
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

test("uses defaults for explicit undefined timeout values, including the bounded redirect TTL", () => {
  expect(
    resolveClientOptions({ timeouts: { attemptMs: undefined } } as never, validateCapabilities)
      .timeouts.attemptMs,
  ).toBe(1_800_000);
  expect(
    resolveClientOptions(
      { timeouts: { attemptMs: 5000, redirectStateTtlMs: undefined } } as never,
      validateCapabilities,
    ).timeouts.redirectStateTtlMs,
  ).toBe(5000);
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
