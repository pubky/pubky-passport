// @vitest-environment node
import { expect, test, vi } from "vitest";
import type { PassportClientOptions } from "../config/PassportClientOptions.js";
import { resolveClientOptions } from "../config/resolveClientOptions.js";
import { InstanceResolver } from "./InstanceResolver.js";
import type { MessageContext } from "../errors/messageTypes.js";

const D = "https://passport.example";
const C = "https://custom.example";
const key = `pubky-passport:instance:${D}`;
const timestamp = 1000;
function fixture(
  options: PassportClientOptions = {},
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
    () => timestamp,
    messageContext,
  );
  const choice = (origin: string) =>
    values.set(key, JSON.stringify({ v: 1, origin, savedAt: timestamp }));
  return { resolver, values, storage, getStorage, onDiagnostic, choice };
}

test("selects the normalized default without browser access at construction", () => {
  const f = fixture({ instance: "PASSPORT.example:443/" });
  expect(f.getStorage).not.toHaveBeenCalled();
  expect(f.resolver.getInstance()).toEqual({
    origin: D,
    host: "passport.example",
    source: "default",
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
      source: "user",
      isCustom: true,
    },
  });
  expect(Object.isFrozen(a.resolver.getInstance())).toBe(true);
  expect(b.resolver.getInstance().origin).toBe(D);
  expect(a.storage.setItem).toHaveBeenCalledOnce();
  a.resolver.resetInstance();
  expect(a.resolver.getInstance().origin).toBe(D);
  expect(a.values.size).toBe(0);
});

test("a locked app uses D without reading or deleting its saved choice", () => {
  const f = fixture({ allowCustomInstance: false });
  f.choice(C);
  const saved = f.values.get(key);
  expect(f.resolver.getInstance().origin).toBe(D);
  expect(f.getStorage).not.toHaveBeenCalled();
  expect(f.resolver.setInstance(C)).toMatchObject({ ok: false, code: "instance_not_allowed" });
  expect(f.resolver.setInstance(D)).toMatchObject({ ok: true, instance: { source: "default" } });
  expect(f.values.get(key)).toBe(saved);
  expect(f.getStorage).not.toHaveBeenCalled();
  expect(f.values.has(key)).toBe(true);
  expect(f.onDiagnostic).not.toHaveBeenCalled();
});

test.each([
  ["http://custom.example", "invalid"],
  ["https://localhost", "invalid"],
  ["https://other.example", "not_allowed"],
])(
  "revalidates each stored choice against HTTPS and the exact allow-list: %s",
  (origin, reason) => {
    const f = fixture({ allowedInstances: [C] });
    f.choice(C);
    expect(f.resolver.getInstance()).toMatchObject({ origin: C, source: "user", isCustom: true });
    f.choice(origin);
    expect(f.resolver.getInstance().origin).toBe(D);
    expect(f.onDiagnostic).toHaveBeenCalledExactlyOnceWith({
      code: "instance_choice_ignored",
      reason,
    });
    expect(f.values.has(key)).toBe(true);
    expect(f.storage.setItem).not.toHaveBeenCalled();
  },
);

test("deletes malformed choices and never sends raw stored input to diagnostics", () => {
  const f = fixture();
  const canary = "private-" + "stored-input";
  f.values.set(key, canary);
  expect(f.resolver.getInstance().origin).toBe(D);
  expect(f.values.has(key)).toBe(false);
  expect(f.onDiagnostic).toHaveBeenCalledExactlyOnceWith({
    code: "instance_choice_ignored",
    reason: "malformed",
  });
  expect(JSON.stringify(f.onDiagnostic.mock.calls)).not.toContain(canary);
});

test("always permits D and compares normalized allow-list origins exactly", () => {
  const f = fixture({ allowedInstances: ["CUSTOM.example:443/"] });
  expect(f.resolver.setInstance("CUSTOM.example")).toMatchObject({ ok: true });
  expect(JSON.parse(f.values.get(key)!).origin).toBe(C);
  expect(f.resolver.getInstance().origin).toBe(C);
  expect(f.resolver.setInstance(C + ".evil.example")).toMatchObject({
    ok: false,
    code: "instance_not_allowed",
  });
  expect(f.resolver.setInstance(D)).toMatchObject({
    ok: true,
    instance: { source: "user", isCustom: false },
  });
  const closed = fixture({ allowedInstances: [] });
  expect(closed.resolver.setInstance(D).ok).toBe(true);
  expect(closed.resolver.setInstance(C).ok).toBe(false);
});

test("returns non-throwing instance errors with overridable contextual messages", () => {
  const f = fixture({
    allowedInstances: [],
    messages: {
      "instance.instance_invalid": "Use a secure address.",
      "instance.instance_not_allowed": "Use {defaultHost} for {appName}.",
    },
    appName: "Demo",
  });
  expect(f.resolver.setInstance("http://custom.example")).toEqual({
    ok: false,
    code: "instance_invalid",
    detail: "insecure_scheme",
    message: "Use a secure address.",
  });
  expect(f.resolver.setInstance(C)).toEqual({
    ok: false,
    code: "instance_not_allowed",
    message: "Use passport.example for Demo.",
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
    source: "default",
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

test("normalizes a stored origin without losing its source or emitting a diagnostic", () => {
  const f = fixture();
  f.choice("CUSTOM.example:443/");
  expect(f.resolver.getInstance()).toMatchObject({ origin: C, source: "user", isCustom: true });
  expect(f.onDiagnostic).not.toHaveBeenCalled();
});

test("instance error overrides use browser app context and the relevant validated host", () => {
  const context = vi.fn(() => ({ appName: "Browser App" }));
  const f = fixture(
    {
      allowedInstances: [C],
      messages: {
        "instance.instance_invalid": "{appName}|{instanceHost}|{defaultHost}",
        "instance.instance_not_allowed": "{appName}|{instanceHost}|{defaultHost}",
      },
    },
    context,
  );
  expect(context).not.toHaveBeenCalled();
  f.choice(C);
  expect(f.resolver.setInstance("invalid origin")).toMatchObject({
    code: "instance_invalid",
    message: "Browser App|custom.example|passport.example",
  });
  expect(f.resolver.setInstance("REJECTED.example:8443/")).toMatchObject({
    code: "instance_not_allowed",
    message: "Browser App|rejected.example:8443|passport.example",
  });
});

test("a throwing browser message context retains safe construction-time copy", () => {
  const f = fixture(
    {
      appName: "Configured App",
      messages: {
        "instance.instance_invalid": "{appName}|{instanceHost}|{defaultHost}",
      },
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
