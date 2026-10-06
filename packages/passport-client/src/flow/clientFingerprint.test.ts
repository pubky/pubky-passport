// @vitest-environment node
import { expect, test } from "vitest";
import type { InternalClientOptions } from "../config/PassportClientOptions.js";
import { resolveBrowserOptions, resolveClientOptions } from "../config/resolveClientOptions.js";
import { clientFingerprint } from "./clientFingerprint.js";

function options(overrides: InternalClientOptions = {}) {
  return resolveBrowserOptions(
    resolveClientOptions(overrides, (value) => value),
    { hostname: "client.example" },
  );
}

test("fingerprints exactly the five resolved fields in canonical order, including the required profile default", () => {
  expect(clientFingerprint(options())).toBe(
    '["client.example","","client.example","https://passport.pubky.app","required"]',
  );
  expect(
    clientFingerprint(
      options({ appName: "  Cafe\u0301  ", instance: "https://Passport.Example:443/" }),
    ),
  ).toBe('["Café","","client.example","https://passport.example","required"]');
});

test.each([
  { appName: "Another app" },
  { capabilities: "/pub/example.app/:rw" },
  { clientId: "another-client" },
  { instance: "https://another.example" },
  { profile: "optional" as const },
])("changing a bound field separates clients: %j", (change) => {
  expect(clientFingerprint(options(change))).not.toBe(clientFingerprint(options()));
});

test.each([
  {
    network: "testnet" as const,
    pkarrRelays: "https://a.example/pkarr",
    httpRelay: "https://a.example/inbox",
  },
  { pkarrRelays: "https://a.example/pkarr" },
  { httpRelay: "https://a.example/inbox" },
])("a network or relay setting separates clients and is appended: %j", (change) => {
  const resolved = options(change);
  expect(clientFingerprint(resolved)).not.toBe(clientFingerprint(options()));
  expect(JSON.parse(clientFingerprint(resolved)).slice(5)).toEqual([
    resolved.network,
    resolved.pkarrRelays ?? null,
    resolved.httpRelay ?? null,
  ]);
});

test("texts and timeouts do not change the fingerprint", () => {
  expect(
    clientFingerprint(
      options({
        messages: { "error.internal": "Please retry" },
        timeouts: { attemptMs: 1000 },
      }),
    ),
  ).toBe(clientFingerprint(options()));
});

test("quoted and non-ASCII names are serialized as data without collisions", () => {
  const resolved = options({ appName: 'An "app", مثال', clientId: "client,one" });
  expect(JSON.parse(clientFingerprint(resolved))).toEqual([
    resolved.appName,
    resolved.capabilities,
    resolved.clientId,
    resolved.instance,
    "required",
  ]);
});
