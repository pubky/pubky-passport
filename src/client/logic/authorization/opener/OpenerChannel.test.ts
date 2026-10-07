// @vitest-environment node
import { Result } from "better-result";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  OPENER_KEYCHAIN_FEATURE,
  OpenerChannel,
  installOpenerChannel,
  takeOpenerChannel,
  type OpenerRequestState,
} from "./OpenerChannel";
import { LOGGER } from "@/libs/logger/logger";

const ATTEMPT = "AbCd_0123456789--";
const ORIGIN = "https://client.example";
// The digest of the request the document holds (A40); a hello must carry it to bind.
const DIGEST = "d".repeat(43);
const hello = (overrides: Record<string, unknown> = {}) => ({
  type: "pubky-passport.hello",
  version: 2,
  attemptId: ATTEMPT,
  features: ["outcome-v2", "status"],
  request: DIGEST,
  ...overrides,
});
const features: { name: string; input: unknown; valid: boolean }[] = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../packages/passport-client/test-vectors/opener-features.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
function fixture(request: OpenerRequestState = { status: "valid" }) {
  const target = new EventTarget();
  const opener = { postMessage: vi.fn() };
  const appWindow = {
    opener,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  } as unknown as Window;
  const channel = OpenerChannel.create(
    appWindow,
    request,
    request.status === "valid" ? DIGEST : undefined,
  )!;
  const send = (data: unknown = hello(), origin = ORIGIN, source: unknown = opener) => {
    target.dispatchEvent(Object.assign(new Event("message"), { data, origin, source }));
  };
  return { channel, opener, appWindow, target, send };
}
afterEach(() => {
  takeOpenerChannel()?.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("binds once and replies synchronously before observers can inspect local state", () => {
  const f = fixture();
  const order: string[] = [];
  f.opener.postMessage.mockImplementation(() => order.push("ready"));
  f.channel.subscribe(() => order.push("observer"));
  f.send(hello({ profile: "optional", extra: "ignored" }));
  expect(order).toEqual(["ready", "observer"]);
  expect(f.opener.postMessage).toHaveBeenCalledWith(
    {
      type: "pubky-passport.ready",
      version: 2,
      attemptId: ATTEMPT,
      protocols: [1, 2],
      features: ["outcome-v2", "status", "profile-setup"],
      request: { status: "valid" },
    },
    ORIGIN,
  );
  expect(f.channel.verifiedOpener()).toEqual({
    verifiedOrigin: ORIGIN,
    attemptId: ATTEMPT,
    features: ["outcome-v2", "status"],
    profile: "optional",
    request: DIGEST,
  });
  expect(Object.isFrozen(f.channel.verifiedOpener())).toBe(true);
  expect(Object.isFrozen(f.channel.verifiedOpener()?.features)).toBe(true);
  f.send(hello({ profile: "required", features: [] }));
  expect(f.channel.verifiedOpener()?.profile).toBe("optional");
  expect(order).toEqual(["ready", "observer", "ready"]);
  f.send(hello(), "https://other.example");
  f.send(hello({ attemptId: "other-attempt-0123" }));
  expect(f.opener.postMessage).toHaveBeenCalledTimes(2);
});

it("keeps an app's keychain feature on its binding, a hint Passport never echoes", () => {
  // The package's hello names the same token (`KEYCHAIN_FEATURE`) while it offers its own route.
  expect(OPENER_KEYCHAIN_FEATURE).toBe("keychain");
  const f = fixture();
  f.send(hello({ features: ["outcome-v2", "status", OPENER_KEYCHAIN_FEATURE] }));
  expect(f.channel.verifiedOpener()?.features).toEqual([
    "outcome-v2",
    "status",
    OPENER_KEYCHAIN_FEATURE,
  ]);
  // Passport's own features are what it supports, whatever the app offers.
  expect(f.opener.postMessage).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      type: "pubky-passport.ready",
      features: ["outcome-v2", "status", "profile-setup"],
    }),
    ORIGIN,
  );
  // A later hello cannot add it to a binding made without it, nor take it away.
  const plain = fixture();
  plain.send(hello());
  plain.send(hello({ features: [OPENER_KEYCHAIN_FEATURE] }));
  expect(plain.channel.verifiedOpener()?.features).toEqual(["outcome-v2", "status"]);
  f.send(hello({ features: [] }));
  expect(f.channel.verifiedOpener()?.features).toContain(OPENER_KEYCHAIN_FEATURE);
});

it.each([
  "https://client.example:8443",
  "https://127.0.0.1",
  "http://localhost:5173",
  "http://127.0.0.1:3100",
  "http://[::1]:5173",
])("accepts the specified opener origin %s", (origin) => {
  const f = fixture();
  f.send(hello(), origin);
  expect(f.channel.verifiedOpener()?.verifiedOrigin).toBe(origin);
});
it.each([
  "null",
  "",
  "http://client.example",
  "http://localhost.:5173",
  "http://localhost.evil.com",
  "http://127.0.0.2",
  "http://[::2]",
  "ftp://client.example",
])("rejects %s before touching source or message data", (origin) => {
  const f = fixture();
  const event = Object.defineProperties(new Event("message"), {
    origin: { value: origin },
    source: {
      get() {
        throw new Error("source inspected before origin");
      },
    },
    data: {
      get() {
        throw new Error("data inspected before origin");
      },
    },
  });
  f.target.dispatchEvent(event);
  expect(f.opener.postMessage).not.toHaveBeenCalled();
});
it("accepts only the current opener's window reference", () => {
  const f = fixture();
  f.send(hello(), ORIGIN, {});
  expect(f.channel.verifiedOpener()).toBeUndefined();
  Object.defineProperty(f.appWindow, "opener", { value: null });
  f.send();
  expect(f.opener.postMessage).not.toHaveBeenCalled();
});

it("keeps all shared feature vectors", () => {
  expect(features).toHaveLength(16);
});
it.each(features)("feature vector: $name", ({ input, valid }) => {
  const f = fixture();
  f.send(hello({ features: input }));
  expect(f.opener.postMessage).toHaveBeenCalledTimes(valid ? 1 : 0);
});
it.each([
  null,
  [],
  "hello",
  hello({ type: "unknown" }),
  hello({ version: 1 }),
  hello({ attemptId: "short" }),
  hello({ attemptId: "a".repeat(65) }),
  hello({ attemptId: ATTEMPT + "\n" }),
  hello({ features: new Array(1) }),
  hello({ features: undefined }),
])("ignores malformed hello %#", (data) => {
  const f = fixture();
  f.send(data);
  expect(f.opener.postMessage).not.toHaveBeenCalled();
});
it.each(["required", "optional", undefined, "other", true, null])(
  "binds the profile setting without rejecting unknown values: %s",
  (profile) => {
    const f = fixture();
    f.send(hello({ profile }));
    expect(f.channel.verifiedOpener()?.profile).toBe(
      profile === "required" || profile === "optional" ? profile : undefined,
    );
    expect(f.opener.postMessage).toHaveBeenCalledOnce();
  },
);
it.each<OpenerRequestState>([
  { status: "valid" },
  { status: "invalid", code: "invalid_relay" },
  { status: "expired" },
  { status: "empty" },
  { status: "completed" },
])("reports only safe request state: $status", (request) => {
  const f = fixture(request);
  f.send();
  expect(f.opener.postMessage.mock.calls[0]?.[0].request).toEqual(request);
  expect(Object.keys(f.opener.postMessage.mock.calls[0]?.[0]).sort()).toEqual([
    "attemptId",
    "features",
    "protocols",
    "request",
    "type",
    "version",
  ]);
});
it("updates request state while an empty channel stays empty", () => {
  const f = fixture();
  f.send();
  f.channel.updateRequestState({ status: "invalid", code: "history_unavailable" });
  f.send();
  expect(f.opener.postMessage.mock.lastCall?.[0].request).toEqual({
    status: "invalid",
    code: "history_unavailable",
  });
  const empty = fixture({ status: "empty" });
  empty.channel.updateRequestState({ status: "completed" });
  empty.send();
  expect(empty.opener.postMessage.mock.lastCall?.[0].request).toEqual({ status: "empty" });
});

it.each(["update", "post"])("completed is final after %s", (method) => {
  const f = fixture();
  f.send();
  if (method === "update") f.channel.updateRequestState({ status: "completed" });
  else
    f.channel.post({
      type: "pubky-passport.authorization-outcome",
      messageId: "id",
      outcome: "cancel",
    });
  f.channel.updateRequestState({ status: "invalid", code: "history_unavailable" });
  f.channel.updateRequestState({ status: "expired" });
  f.send();
  expect(f.opener.postMessage.mock.lastCall?.[0].request).toEqual({ status: "completed" });
});

it.each(["expired", "invalid"] as const)("can invalidate %s on a failed scrub", (status) => {
  const f = fixture(status === "invalid" ? { status, code: "invalid_relay" } : { status });
  f.channel.updateRequestState({ status: "invalid", code: "history_unavailable" });
  f.send();
  expect(f.opener.postMessage.mock.lastCall?.[0].request).toEqual({
    status: "invalid",
    code: "history_unavailable",
  });
});

it.each(["", "a".repeat(129), undefined, null, 1])(
  "rejects an invalid outgoing message id without posting: %#",
  (messageId) => {
    const f = fixture();
    f.send();
    f.opener.postMessage.mockClear();
    const result = f.channel.post({
      type: "pubky-passport.authorization-outcome",
      outcome: "cancel",
      messageId: messageId as string,
    });
    expect(Result.isError(result) && result.error).toEqual({ code: "post_failed" });
    expect(f.opener.postMessage).not.toHaveBeenCalled();
    f.send();
    expect(f.opener.postMessage.mock.lastCall?.[0].request).toEqual({ status: "valid" });
  },
);

it("never posts a runtime-injected arbitrary reason", () => {
  const f = fixture();
  f.send();
  f.opener.postMessage.mockClear();
  const result = f.channel.post({
    type: "pubky-passport.authorization-outcome",
    messageId: "id",
    outcome: "error",
    code: "private-reason" as "approval_failed",
  });
  expect(Result.isError(result) && result.error).toEqual({ code: "post_failed" });
  expect(f.opener.postMessage).not.toHaveBeenCalled();
});

it.each(["ring", "granting"] as const)(
  "posts only the explicit %s phase, without replay",
  (phase) => {
    const f = fixture();
    expect(Result.isError(f.channel.post({ type: "pubky-passport.status", phase }))).toBe(true);
    f.send();
    f.opener.postMessage.mockClear();
    f.channel.post({ type: "pubky-passport.status", phase });
    expect(f.opener.postMessage).toHaveBeenCalledExactlyOnceWith(
      { type: "pubky-passport.status", phase, version: 2, attemptId: ATTEMPT },
      ORIGIN,
    );
    f.send();
    expect(f.opener.postMessage.mock.lastCall?.[0].type).toBe("pubky-passport.ready");
    expect(f.opener.postMessage).toHaveBeenCalledTimes(2);
    f.channel.dispose();
    expect(Result.isError(f.channel.post({ type: "pubky-passport.status", phase }))).toBe(true);
  },
);

it.each([undefined, null, "profile", "signed-in", "ring\n"])(
  "rejects an unknown outgoing phase %#",
  (phase) => {
    const f = fixture();
    f.send();
    f.opener.postMessage.mockClear();
    const result = f.channel.post({ type: "pubky-passport.status", phase: phase as "ring" });
    expect(Result.isError(result) && result.error.code).toBe("post_failed");
    expect(f.opener.postMessage).not.toHaveBeenCalled();
  },
);

it.each(["expired", "invalid", "completed"] as const)(
  "never posts a phase after the request is %s",
  (status) => {
    const f = fixture();
    f.send();
    f.channel.updateRequestState(
      status === "invalid" ? { status, code: "invalid_relay" } : { status },
    );
    f.opener.postMessage.mockClear();
    for (const phase of ["ring", "granting"] as const)
      expect(Result.isError(f.channel.post({ type: "pubky-passport.status", phase }))).toBe(true);
    expect(f.opener.postMessage).not.toHaveBeenCalled();
    f.send();
    expect(f.opener.postMessage.mock.lastCall?.[0].request.status).toBe(status);
  },
);

it("never posts a phase after an outcome", () => {
  const f = fixture();
  f.send();
  f.channel.post({
    type: "pubky-passport.authorization-outcome",
    messageId: "terminal",
    outcome: "cancel",
  });
  f.opener.postMessage.mockClear();
  f.channel.post({ type: "pubky-passport.status", phase: "ring" });
  expect(f.opener.postMessage).not.toHaveBeenCalled();
  f.send();
  expect(f.opener.postMessage.mock.lastCall?.[0].request).toEqual({ status: "completed" });
});

it("omits code entirely when an outcome has no reason", () => {
  const f = fixture();
  f.send();
  f.channel.post({
    type: "pubky-passport.authorization-outcome",
    messageId: "id",
    outcome: "success",
  });
  expect(f.opener.postMessage.mock.lastCall?.[0]).toEqual({
    type: "pubky-passport.authorization-outcome",
    version: 2,
    attemptId: ATTEMPT,
    messageId: "id",
    outcome: "success",
  });
  expect(f.opener.postMessage.mock.lastCall?.[0]).not.toHaveProperty("code");
});
it("unsubscribes and disposes every listener and binding on pagehide", () => {
  const f = fixture();
  const listener = vi.fn();
  const unsubscribe = f.channel.subscribe(listener);
  unsubscribe();
  f.send();
  expect(listener).not.toHaveBeenCalled();
  f.target.dispatchEvent(new Event("pagehide"));
  f.send();
  expect(f.opener.postMessage).toHaveBeenCalledOnce();
  expect(f.channel.verifiedOpener()).toBeUndefined();
  f.channel.subscribe(listener);
  f.send();
  expect(listener).not.toHaveBeenCalled();
});
it("contains observer and postMessage failures without exposing messages", () => {
  const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
  const f = fixture();
  const delivered = vi.fn();
  f.channel.subscribe(() => {
    throw new Error("observer");
  });
  f.channel.subscribe(delivered);
  f.opener.postMessage.mockImplementation(() => {
    throw new Error("post failed");
  });
  f.send();
  expect(delivered).toHaveBeenCalledOnce();
  expect(f.channel.verifiedOpener()?.verifiedOrigin).toBe(ORIGIN);
  for (const operation of ["listener", "post"])
    expect(warn).toHaveBeenCalledWith("authorize.opener.failed", {
      operation,
      diagnosticId: expect.any(String),
      errorName: "Error",
    });
  expect(JSON.stringify(warn.mock.calls)).not.toContain("observer");
  expect(JSON.stringify(warn.mock.calls)).not.toContain("post failed");
});
it("installs only with an opener and exposes the document's channel until pagehide", () => {
  const f = fixture();
  f.channel.dispose();
  installOpenerChannel(f.appWindow, { status: "empty" });
  expect(takeOpenerChannel()).toBeDefined();
  expect(takeOpenerChannel()).toBe(takeOpenerChannel());
  f.target.dispatchEvent(new Event("pagehide"));
  expect(takeOpenerChannel()).toBeUndefined();
  Object.defineProperty(f.appWindow, "opener", { value: null });
  installOpenerChannel(f.appWindow, { status: "empty" });
  expect(takeOpenerChannel()).toBeUndefined();
});

it("releases partial listeners when channel installation fails", () => {
  const f = fixture();
  f.channel.dispose();
  const add = f.target.addEventListener.bind(f.target);
  f.appWindow.addEventListener = ((type: string, ...args: unknown[]) => {
    if (type === "pagehide") throw new Error("listener unavailable");
    Reflect.apply(add, f.target, [type, ...args]);
  }) as Window["addEventListener"];
  expect(OpenerChannel.create(f.appWindow, { status: "valid" })).toBeUndefined();
  f.send();
  expect(f.opener.postMessage).not.toHaveBeenCalled();
});

it("replacing an ack wait cancels the old one without deleting the replacement", async () => {
  const f = fixture();
  f.send();
  const signal = new AbortController().signal;
  const old = f.channel.waitForAck("duplicate", signal);
  const current = f.channel.waitForAck("duplicate", signal);
  expect(await old.result).toBe(false);
  old.cancel();
  f.send({
    type: "pubky-passport.authorization-outcome-ack",
    version: 2,
    attemptId: ATTEMPT,
    messageId: "duplicate",
  });
  expect(await current.result).toBe(true);
});

it("sends status/outcomes only to the pinned origin and reports completed after an outcome", () => {
  const f = fixture();
  expect(Result.isError(f.channel.post({ type: "pubky-passport.status", phase: "ring" }))).toBe(
    true,
  );
  f.send();
  expect(Result.isOk(f.channel.post({ type: "pubky-passport.status", phase: "ring" }))).toBe(true);
  expect(f.opener.postMessage.mock.lastCall).toEqual([
    { type: "pubky-passport.status", version: 2, attemptId: ATTEMPT, phase: "ring" },
    ORIGIN,
  ]);
  f.channel.post({
    type: "pubky-passport.authorization-outcome",
    messageId: "outcome-id",
    outcome: "error",
    code: "storage_unavailable",
  });
  expect(f.opener.postMessage.mock.lastCall).toEqual([
    {
      type: "pubky-passport.authorization-outcome",
      version: 2,
      attemptId: ATTEMPT,
      messageId: "outcome-id",
      outcome: "error",
      code: "storage_unavailable",
    },
    ORIGIN,
  ]);
  f.send();
  expect(f.opener.postMessage.mock.lastCall?.[0].request).toEqual({ status: "completed" });
  f.channel.dispose();
  expect(Result.isError(f.channel.post({ type: "pubky-passport.status", phase: "granting" }))).toBe(
    true,
  );
});

it("an empty channel never sends status or outcomes or accepts an acknowledgement", async () => {
  const f = fixture({ status: "empty" });
  f.send();
  expect(Result.isError(f.channel.post({ type: "pubky-passport.status", phase: "ring" }))).toBe(
    true,
  );
  expect(
    Result.isError(
      f.channel.post({
        type: "pubky-passport.authorization-outcome",
        messageId: "id",
        outcome: "cancel",
      }),
    ),
  ).toBe(true);
  await expect(f.channel.waitForAck("id", new AbortController().signal).result).resolves.toBe(
    false,
  );
  expect(f.opener.postMessage).toHaveBeenCalledOnce();
});

it("accepts only an acknowledgement from the bound origin/source with matching ids", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.send();
  const controller = new AbortController();
  const pending = f.channel.waitForAck("message-1", controller.signal);
  const settled = vi.fn();
  void pending.result.then(settled);
  const ack = {
    type: "pubky-passport.authorization-outcome-ack",
    version: 2,
    attemptId: ATTEMPT,
    messageId: "message-1",
  };
  f.send(ack, "https://other.example");
  f.send(ack, ORIGIN, {});
  f.send({ ...ack, attemptId: "other-attempt-0123" });
  f.send({ ...ack, messageId: "other-message" });
  f.send({ ...ack, version: 1 });
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  f.send(ack);
  await expect(pending.result).resolves.toBe(true);
  f.send(ack);
  pending.cancel();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["timeout", "abort", "cancel", "pagehide"])(
  "settles pending acks and clears timers on %s",
  async (ending) => {
    vi.useFakeTimers();
    const f = fixture();
    f.send();
    const controller = new AbortController();
    const pending = f.channel.waitForAck("id", controller.signal);
    if (ending === "timeout") {
      vi.advanceTimersByTime(2999);
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(1);
    }
    if (ending === "abort") controller.abort();
    if (ending === "cancel") pending.cancel();
    if (ending === "pagehide") f.target.dispatchEvent(new Event("pagehide"));
    await expect(pending.result).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("does not wait without a binding, with an aborted signal or for invalid message ids", async () => {
  const f = fixture();
  const controller = new AbortController();
  await expect(f.channel.waitForAck("id", controller.signal).result).resolves.toBe(false);
  f.send();
  await expect(f.channel.waitForAck("", controller.signal).result).resolves.toBe(false);
  await expect(f.channel.waitForAck("a".repeat(129), controller.signal).result).resolves.toBe(
    false,
  );
  controller.abort();
  await expect(f.channel.waitForAck("id", controller.signal).result).resolves.toBe(false);
});

it.each(["setup", "cleanup"])(
  "settles ack waits even when abort-listener %s throws",
  async (phase) => {
    vi.useFakeTimers();
    const f = fixture();
    f.send();
    const signal = new AbortController().signal;
    vi.spyOn(
      signal,
      phase === "setup" ? "addEventListener" : "removeEventListener",
    ).mockImplementation(() => {
      throw new Error("listener unavailable");
    });
    const pending = f.channel.waitForAck("id", signal);
    pending.cancel();
    await expect(pending.result).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("does not expose valid as a request-state update", () => {
  expectTypeOf<Parameters<OpenerChannel["updateRequestState"]>[0]>()
    .extract<{ status: "valid" }>()
    .toBeNever();
});

it.each([
  ["another request's digest", { request: "e".repeat(43) }],
  ["no digest", { request: undefined }],
  ["a malformed digest", { request: "d".repeat(42) }],
])("A40: a hello with %s never binds or replies", (_name, overrides) => {
  const f = fixture();
  const observer = vi.fn();
  f.channel.subscribe(observer);
  f.send(hello(overrides));
  expect(f.opener.postMessage).not.toHaveBeenCalled();
  expect(f.channel.verifiedOpener()).toBeUndefined();
  expect(observer).not.toHaveBeenCalled();
  // The app that did open this request still binds afterwards.
  f.send(hello());
  expect(f.channel.verifiedOpener()?.request).toBe(DIGEST);
});

it.each([
  { status: "empty" },
  { status: "invalid", code: "invalid_url" },
  { status: "expired" },
] as const)("M1: %j answers ready but never names the opener as a requester", (request) => {
  const f = fixture(request);
  f.send(hello({ request: undefined }));
  expect(f.opener.postMessage).toHaveBeenCalledOnce();
  expect(f.opener.postMessage.mock.lastCall?.[0].request).toEqual(request);
  expect(f.channel.verifiedOpener()).toBeUndefined();
});

it("digests the request a valid entry holds, so only its own app's hello binds", async () => {
  const { ValidatedPubkyAuthRequest } = await import("../request/ValidatedPubkyAuthRequest");
  const { requestDigest } = await import("@/libs/requestDigest");
  const url =
    "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=" +
    ["kqnceEMgrNQM_xi06oQXjA3c", "JHX_RQmw1BY6JE1bse8"].join("");
  const validated = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(url));
  if (Result.isError(validated)) throw new Error(validated.error.code);
  const target = new EventTarget();
  const opener = { postMessage: vi.fn() };
  const appWindow = {
    opener,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  } as unknown as Window;
  installOpenerChannel(appWindow, { status: "valid", request: validated.value });
  const send = (request: string) =>
    target.dispatchEvent(
      Object.assign(new Event("message"), {
        data: hello({ request }),
        origin: ORIGIN,
        source: opener,
      }),
    );
  send(DIGEST);
  expect(takeOpenerChannel()?.verifiedOpener()).toBeUndefined();
  send(requestDigest(url));
  expect(takeOpenerChannel()?.verifiedOpener()?.verifiedOrigin).toBe(ORIGIN);
  expect(JSON.stringify(opener.postMessage.mock.calls)).not.toContain("secret");
  validated.value.release();
});

it("gives a request document's opener a short grace to bind, and none elsewhere", () => {
  const valid = fixture();
  const remaining = valid.channel.helloGraceRemaining();
  expect(remaining).toBeGreaterThan(0);
  expect(remaining).toBeLessThanOrEqual(1_000);
  expect(valid.channel.helloGraceRemaining(Date.now() + 1_000)).toBe(0);
  valid.send();
  expect(valid.channel.helloGraceRemaining()).toBe(0);
  for (const request of [{ status: "empty" }, { status: "expired" }] as const)
    expect(fixture(request).channel.helloGraceRemaining()).toBe(0);
});

const RING_KEY = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const profileNeeded = (overrides: Record<string, unknown> = {}) => ({
  type: "pubky-passport.profile-needed",
  version: 2,
  attemptId: ATTEMPT,
  publicKey: RING_KEY,
  ...overrides,
});

it("takes profile-needed only from the app bound to this request, for one valid key", () => {
  const f = fixture();
  const notified = vi.fn();
  f.channel.subscribe(notified);
  // Before any binding, nothing counts.
  f.send(profileNeeded());
  expect(f.channel.profileRequest()).toBeUndefined();
  f.send();
  notified.mockClear();
  for (const bad of [
    profileNeeded({ attemptId: "Z".repeat(22) }),
    profileNeeded({ version: 1 }),
    profileNeeded({ publicKey: "not-a-key" }),
  ])
    f.send(bad);
  f.send(profileNeeded(), "https://attacker.example");
  f.send(profileNeeded(), ORIGIN, { postMessage: vi.fn() });
  expect(f.channel.profileRequest()).toBeUndefined();
  expect(notified).not.toHaveBeenCalled();
  f.send(profileNeeded());
  expect(f.channel.profileRequest()).toBe(RING_KEY);
  expect(notified).toHaveBeenCalledOnce();
  // A second key cannot replace the first.
  f.send(profileNeeded({ publicKey: "y".repeat(52) }));
  expect(f.channel.profileRequest()).toBe(RING_KEY);
});

it("answers profile-ready to the bound app, and only once it asked", () => {
  const f = fixture();
  f.send();
  f.opener.postMessage.mockClear();
  expect(f.channel.postProfileReady().isErr()).toBe(true);
  f.send(profileNeeded());
  expect(f.channel.postProfileReady().isOk()).toBe(true);
  expect(f.opener.postMessage).toHaveBeenCalledExactlyOnceWith(
    { type: "pubky-passport.profile-ready", version: 2, attemptId: ATTEMPT },
    ORIGIN,
  );
});

it("binds a profile page only to a hello naming its key, never as a request's opener", () => {
  const target = new EventTarget();
  const opener = { postMessage: vi.fn() };
  const appWindow = {
    opener,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  } as unknown as Window;
  const channel = OpenerChannel.create(appWindow, { status: "empty" }, undefined, RING_KEY)!;
  const send = (data: unknown) =>
    target.dispatchEvent(
      Object.assign(new Event("message"), { data, origin: ORIGIN, source: opener }),
    );
  send(hello({ request: undefined, profileKey: "y".repeat(52) }));
  expect(channel.profileOpener()).toBeUndefined();
  expect(opener.postMessage).not.toHaveBeenCalled();
  send(hello({ request: undefined, profileKey: RING_KEY }));
  expect(channel.profileOpener()).toMatchObject({ verifiedOrigin: ORIGIN, profileKey: RING_KEY });
  expect(channel.verifiedOpener()).toBeUndefined();
  // A profile page ignores profile-needed (it names its key itself) and answers profile-ready.
  send(profileNeeded());
  expect(channel.profileRequest()).toBeUndefined();
  opener.postMessage.mockClear();
  expect(channel.postProfileReady().isOk()).toBe(true);
  expect(opener.postMessage).toHaveBeenCalledWith(
    { type: "pubky-passport.profile-ready", version: 2, attemptId: ATTEMPT },
    ORIGIN,
  );
  channel.dispose();
});

describe("network", () => {
  function networkFixture(network: "mainnet" | "testnet", profileKey?: string) {
    const target = new EventTarget();
    const opener = { postMessage: vi.fn() };
    const appWindow = {
      opener,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    } as unknown as Window;
    const channel = OpenerChannel.create(
      appWindow,
      profileKey === undefined ? { status: "valid" } : { status: "empty" },
      profileKey === undefined ? DIGEST : undefined,
      profileKey,
      network,
    )!;
    const send = (data: unknown) =>
      target.dispatchEvent(
        Object.assign(new Event("message"), { data, origin: ORIGIN, source: opener }),
      );
    return { channel, opener, send };
  }

  it.each([
    ["mainnet", "testnet"],
    ["testnet", "mainnet"],
  ] as const)(
    "a %s instance answers a hello for the %s as an invalid request, then tells observers",
    (instance, requested) => {
      const f = networkFixture(instance);
      const order: string[] = [];
      f.opener.postMessage.mockImplementation(() => order.push("ready"));
      f.channel.subscribe(() => order.push(`observer:${f.channel.networkMismatch()}`));
      f.send(hello({ network: requested }));
      expect(order).toEqual(["ready", "observer:true"]);
      expect(f.opener.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "pubky-passport.ready",
          request: { status: "invalid", code: "network_mismatch" },
        }),
        ORIGIN,
      );
      // Later hellos get the same answer; nothing can make the request valid again.
      f.send(hello({ network: instance }));
      expect(f.opener.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
        request: { status: "invalid", code: "network_mismatch" },
      });
      expect(f.channel.verifiedOpener()?.network).toBe(requested);
      f.channel.dispose();
    },
  );

  it.each([["testnet"], [undefined], ["devnet"]])(
    "binds a testnet request whose hello names %j as usual",
    (network) => {
      const f = networkFixture("testnet");
      f.send(hello(network === undefined ? {} : { network }));
      expect(f.channel.networkMismatch()).toBe(false);
      expect(f.opener.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ request: { status: "valid" } }),
        ORIGIN,
      );
      expect(f.channel.verifiedOpener()?.network).toBe(
        network === "testnet" ? "testnet" : undefined,
      );
      f.channel.dispose();
    },
  );

  it("never binds a profile page to an app on another network", () => {
    const f = networkFixture("testnet", RING_KEY);
    f.send(hello({ request: undefined, profileKey: RING_KEY, network: "mainnet" }));
    expect(f.channel.profileOpener()).toBeUndefined();
    expect(f.opener.postMessage).not.toHaveBeenCalled();
    f.send(hello({ request: undefined, profileKey: RING_KEY, network: "testnet" }));
    expect(f.channel.profileOpener()).toMatchObject({ profileKey: RING_KEY, network: "testnet" });
    f.channel.dispose();
  });
});

describe("edit-profile page", () => {
  function editFixture(editKey = RING_KEY, network: "mainnet" | "testnet" = "mainnet") {
    const target = new EventTarget();
    const opener = { postMessage: vi.fn() };
    const appWindow = {
      opener,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    } as unknown as Window;
    const channel = OpenerChannel.create(
      appWindow,
      { status: "empty" },
      undefined,
      undefined,
      network,
      editKey,
    )!;
    const send = (data: unknown, origin = ORIGIN, source: unknown = opener) =>
      target.dispatchEvent(Object.assign(new Event("message"), { data, origin, source }));
    return { channel, opener, send };
  }

  it("binds only a hello naming its key, and tells only that origin the profile is updated", () => {
    const f = editFixture();
    expect(f.channel.postProfileUpdated().isErr()).toBe(true);
    f.send(hello({ request: undefined, editProfileKey: "y".repeat(52) }));
    f.send(hello({ request: undefined, profileKey: RING_KEY }));
    expect(f.channel.editOpener()).toBeUndefined();
    expect(f.opener.postMessage).not.toHaveBeenCalled();
    f.send(hello({ request: undefined, editProfileKey: RING_KEY }));
    expect(f.channel.editOpener()).toMatchObject({
      verifiedOrigin: ORIGIN,
      editProfileKey: RING_KEY,
    });
    // An edit page is neither a request's nor a profile setup's page.
    expect(f.channel.verifiedOpener()).toBeUndefined();
    expect(f.channel.profileOpener()).toBeUndefined();
    expect(f.opener.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "pubky-passport.ready", request: { status: "empty" } }),
      ORIGIN,
    );
    // Another origin cannot take the binding over.
    f.send(hello({ request: undefined, editProfileKey: RING_KEY }), "https://other.example");
    expect(f.channel.editOpener()?.verifiedOrigin).toBe(ORIGIN);
    f.opener.postMessage.mockClear();
    expect(f.channel.postProfileUpdated().isOk()).toBe(true);
    expect(f.opener.postMessage).toHaveBeenCalledExactlyOnceWith(
      {
        type: "pubky-passport.profile-updated",
        publicKey: RING_KEY,
        version: 2,
        attemptId: ATTEMPT,
      },
      ORIGIN,
    );
    f.channel.dispose();
  });

  it("never binds an app on another network", () => {
    const f = editFixture(RING_KEY, "testnet");
    f.send(hello({ request: undefined, editProfileKey: RING_KEY, network: "mainnet" }));
    expect(f.channel.editOpener()).toBeUndefined();
    expect(f.channel.postProfileUpdated().isErr()).toBe(true);
    f.channel.dispose();
  });

  it("a request or profile page never posts profile-updated", () => {
    const f = fixture();
    f.send(hello({ editProfileKey: RING_KEY }));
    expect(f.channel.editOpener()).toBeUndefined();
    expect(f.channel.postProfileUpdated().isErr()).toBe(true);
  });
});
