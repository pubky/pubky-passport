// @vitest-environment node
import { expect, test, vi } from "vitest";
import type { InternalClientOptions } from "../config/PassportClientOptions.js";
import { resolveClientOptions } from "../config/resolveClientOptions.js";
import { InstanceResolver } from "./InstanceResolver.js";
import type { MessageContext } from "../errors/messageTypes.js";

const D = "https://passport.example";
const C = "https://custom.example";
const key = `pubky-passport:instance:${D}`;
function fixture(
  options: InternalClientOptions = {},
  messageContext?: () => Partial<MessageContext>,
) {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  const onDiagnostic = vi.fn();
  const getStorage = vi.fn(() => storage);
  const resolver = new InstanceResolver(
    resolveClientOptions({ instance: D, onDiagnostic, ...options }, (caps) => caps),
    getStorage,
    messageContext,
  );
  const choice = (origin: string) => values.set(key, origin);
  return { resolver, values, storage, getStorage, onDiagnostic, choice };
}

test("selects the normalized default without browser access at construction", () => {
  const f = fixture({ instance: "PASSPORT.example:443/" });
  expect(f.getStorage).not.toHaveBeenCalled();
  expect(f.resolver.getInstance()).toEqual({
    origin: D,
    host: "passport.example",
    isCustom: false,
  });
  expect(f.storage.setItem).not.toHaveBeenCalled();
});

test("only explicit set/reset changes this app's choice, with frozen host metadata", () => {
  const a = fixture();
  const b = fixture();
  expect(a.resolver.setInstance("pässport.example:8443")).toEqual({
    ok: true,
    instance: {
      origin: "https://xn--pssport-5wa.example:8443",
      host: "xn--pssport-5wa.example:8443",
      isCustom: true,
    },
  });
  expect(a.values.get(key)).toBe("https://xn--pssport-5wa.example:8443");
  expect(Object.isFrozen(a.resolver.getInstance())).toBe(true);
  expect(b.resolver.getInstance().origin).toBe(D);
  expect(a.storage.setItem).toHaveBeenCalledOnce();
  a.resolver.resetInstance();
  expect(a.resolver.getInstance().origin).toBe(D);
  expect(a.values.size).toBe(0);
});

test("choosing the app's own Passport clears the stored choice", () => {
  const f = fixture();
  f.choice(C);
  expect(f.resolver.setInstance("PASSPORT.example:443/")).toEqual({
    ok: true,
    instance: { origin: D, host: "passport.example", isCustom: false },
  });
  expect(f.values.has(key)).toBe(false);
  expect(f.storage.setItem).not.toHaveBeenCalled();
});

test.each(["http://custom.example", "https://localhost", "not an origin", "https://a.example/x"])(
  "drops a stored choice that no longer validates, without echoing it: %s",
  (origin) => {
    const f = fixture();
    f.choice(C);
    expect(f.resolver.getInstance()).toMatchObject({ origin: C, isCustom: true });
    f.choice(origin);
    expect(f.resolver.getInstance().origin).toBe(D);
    expect(f.values.has(key)).toBe(false);
    expect(f.onDiagnostic).toHaveBeenCalledExactlyOnceWith({ code: "instance_choice_ignored" });
    expect(JSON.stringify(f.onDiagnostic.mock.calls)).not.toContain(origin);
    expect(f.storage.setItem).not.toHaveBeenCalled();
  },
);

test("normalizes a stored origin without emitting a diagnostic", () => {
  const f = fixture();
  f.choice("CUSTOM.example:443/");
  expect(f.resolver.getInstance()).toMatchObject({ origin: C, isCustom: true });
  expect(f.onDiagnostic).not.toHaveBeenCalled();
});

test("returns non-throwing instance errors with overridable contextual messages", () => {
  const f = fixture({
    messages: { "instance.instance_invalid": "Use a secure address for {appName}." },
    appName: "Demo",
  });
  expect(f.resolver.setInstance("http://custom.example")).toEqual({
    ok: false,
    code: "instance_invalid",
    detail: "insecure_scheme",
    message: "Use a secure address for Demo.",
  });
  expect(f.storage.setItem).not.toHaveBeenCalled();
});

test("permits loopback only as the configured default, not as a stored/user choice", () => {
  const f = fixture({
    instance: "http://localhost:3001",
    development: { allowLoopbackInstance: true },
  });
  expect(f.resolver.getInstance()).toMatchObject({
    origin: "http://localhost:3001",
    isCustom: false,
  });
  expect(f.resolver.setInstance("https://localhost:3002")).toMatchObject({
    ok: false,
    code: "instance_invalid",
  });
});

test("contains throwing or reentrant diagnostic observers", () => {
  const f = fixture();
  f.choice("http://custom.example");
  f.onDiagnostic.mockImplementation(() => {
    f.resolver.getInstance();
    throw new Error("observer");
  });
  expect(f.resolver.getInstance().origin).toBe(D);
  expect(f.onDiagnostic).toHaveBeenCalledOnce();
});

test("instance error overrides use browser app context and the current and default hosts", () => {
  const context = vi.fn(() => ({ appName: "Browser App" }));
  const f = fixture(
    { messages: { "instance.instance_invalid": "{appName}|{instanceHost}|{defaultHost}" } },
    context,
  );
  expect(context).not.toHaveBeenCalled();
  f.choice(C);
  expect(f.resolver.setInstance("invalid origin")).toMatchObject({
    code: "instance_invalid",
    message: "Browser App|custom.example|passport.example",
  });
});

test("a throwing browser message context retains safe construction-time copy", () => {
  const f = fixture(
    {
      appName: "Configured App",
      messages: { "instance.instance_invalid": "{appName}|{instanceHost}|{defaultHost}" },
    },
    () => {
      throw new Error("context unavailable");
    },
  );
  expect(f.resolver.setInstance("invalid origin")).toMatchObject({
    code: "instance_invalid",
    message: "Configured App|passport.example|passport.example",
  });
});
