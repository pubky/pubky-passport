// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OpenerChannel } from "../opener/OpenerChannel";
import { handoffOpenerOutcome } from "./openerOutcomeHandoff";

const ORIGIN = "https://opener.example";
const CALLBACK = "https://return.example/callback?private=callback-canary";
const ATTEMPT = "0123456789abcdef";
const channels: OpenerChannel[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const channel of channels.splice(0)) channel.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function fixture(bound = true) {
  const target = new EventTarget();
  const opener = { postMessage: vi.fn(), closed: false };
  const state = {
    opener,
    closed: false,
    crypto: { randomUUID: vi.fn(() => "message-id") },
    location: { replace: vi.fn() },
    close: vi.fn(() => {
      state.closed = true;
    }),
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    setTimeout,
    clearTimeout,
  };
  const appWindow = state as unknown as Window;
  const channel = OpenerChannel.create(appWindow, { status: "valid" }, "d".repeat(43))!;
  channels.push(channel);
  const send = (data: unknown, origin = ORIGIN, source: unknown = opener) =>
    target.dispatchEvent(Object.assign(new Event("message"), { data, origin, source }));
  const hello = () =>
    send({
      type: "pubky-passport.hello",
      version: 2,
      attemptId: ATTEMPT,
      features: [],
      request: "d".repeat(43),
    });
  if (bound) hello();
  opener.postMessage.mockClear();
  const signal = new AbortController();
  const complete = (
    callback: string | undefined = undefined,
    outcome: "success" | "error" | "cancel" = "cancel",
  ) =>
    handoffOpenerOutcome(
      appWindow,
      callback,
      outcome,
      signal.signal,
      channel,
      outcome === "error" ? "relay_unreachable" : undefined,
    );
  const ack = (overrides = {}, origin = ORIGIN) =>
    send(
      {
        type: "pubky-passport.authorization-outcome-ack",
        version: 2,
        attemptId: ATTEMPT,
        messageId: "message-id",
        ...overrides,
      },
      origin,
    );
  return { channel, state, opener, appWindow, send, hello, ack, complete, signal };
}

it.each(["success", "error", "cancel"] as const)(
  "posts %s without callbacks, closes only after a matching ack and clears the wait",
  async (outcome) => {
    const f = fixture();
    const pending = f.complete(undefined, outcome);
    expect(f.opener.postMessage).toHaveBeenCalledExactlyOnceWith(
      {
        type: "pubky-passport.authorization-outcome",
        version: 2,
        attemptId: ATTEMPT,
        messageId: "message-id",
        outcome,
        ...(outcome === "error" ? { code: "relay_unreachable" } : {}),
      },
      ORIGIN,
    );
    expect(f.state.close).not.toHaveBeenCalled();
    f.ack();
    await expect(pending).resolves.toBe("acknowledged-and-closed");
    expect(f.state.close).toHaveBeenCalledOnce();
    expect(f.state.location.replace).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("ignores foreign and stale acknowledgments, then uses the exact foreign-origin callback", async () => {
  const f = fixture();
  const pending = f.complete(CALLBACK);
  f.ack({}, "https://return.example");
  f.ack({ attemptId: "other-attempt-1234" });
  f.ack({ messageId: "other-id" });
  await vi.advanceTimersByTimeAsync(2999);
  expect(f.state.location.replace).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await expect(pending).resolves.toBe("navigated");
  expect(f.state.location.replace).toHaveBeenCalledExactlyOnceWith(CALLBACK);
  expect(f.state.close).not.toHaveBeenCalled();
  expect(JSON.stringify(f.opener.postMessage.mock.calls)).not.toContain("callback-canary");
});

it("uses the local result screen when there is no callback after a timeout", async () => {
  const f = fixture();
  const pending = f.complete();
  await vi.advanceTimersByTimeAsync(3000);
  await expect(pending).resolves.toBe("unavailable");
  expect(f.state.close).not.toHaveBeenCalled();
  expect(f.state.location.replace).not.toHaveBeenCalled();
});

it.each(["success", "cancel"] as const)("never adds a reason to %s", async (outcome) => {
  const f = fixture();
  const pending = handoffOpenerOutcome(
    f.appWindow,
    undefined,
    outcome,
    f.signal.signal,
    f.channel,
    "relay_unreachable",
  );
  expect(f.opener.postMessage.mock.calls[0]?.[0]).not.toHaveProperty("code");
  f.ack();
  await expect(pending).resolves.toBe("acknowledged-and-closed");
});

it.each(["post", "uuid"])(
  "falls back immediately after %s fails and clears its ack wait",
  async (failure) => {
    const f = fixture();
    const fail = () => {
      throw new Error("private-" + "failure");
    };
    if (failure === "post") f.opener.postMessage.mockImplementation(fail);
    else f.state.crypto.randomUUID.mockImplementation(fail);
    await expect(f.complete(CALLBACK)).resolves.toBe("navigated");
    expect(f.state.location.replace).toHaveBeenCalledExactlyOnceWith(CALLBACK);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.each(["close", "navigate"])(
  "contains %s failures and clears the pending ack",
  async (failure) => {
    const f = fixture();
    const fail = () => {
      throw new Error("private-" + "failure");
    };
    if (failure === "close") f.state.close.mockImplementation(fail);
    if (failure === "navigate") f.state.location.replace.mockImplementation(fail);
    const pending = f.complete(CALLBACK);
    if (failure === "close") f.ack();
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toBe(failure === "navigate" ? "unavailable" : "navigated");
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("falls back when an acknowledged window refuses to close", async () => {
  const f = fixture();
  f.state.close.mockImplementation(() => undefined);
  const pending = f.complete(CALLBACK);
  f.ack();
  await expect(pending).resolves.toBe("navigated");
});

it("does not navigate after the document channel is disposed", async () => {
  const f = fixture();
  const pending = f.complete(CALLBACK);
  f.channel.dispose();
  await expect(pending).resolves.toBe("aborted");
  expect(f.state.location.replace).not.toHaveBeenCalled();
  expect(f.state.close).not.toHaveBeenCalled();
});

it.each([true, false])(
  "abandonment stops handoff and navigation, already aborted=%s",
  async (already) => {
    const f = fixture();
    if (already) f.signal.abort();
    const pending = f.complete(CALLBACK);
    f.signal.abort();
    await expect(pending).resolves.toBe("aborted");
    expect(f.state.close).not.toHaveBeenCalled();
    expect(f.state.location.replace).not.toHaveBeenCalled();
    if (already) expect(f.opener.postMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("keeps v1 routing without a hello and does nothing without a callback", async () => {
  const f = fixture(false);
  await expect(f.complete()).resolves.toBe("unavailable");
  expect(f.opener.postMessage).not.toHaveBeenCalled();
  const pending = f.complete(CALLBACK);
  expect(f.opener.postMessage).toHaveBeenCalledWith(
    {
      type: "pubky-passport.authorization-outcome",
      version: 1,
      messageId: "message-id",
      outcome: "cancel",
    },
    "https://return.example",
  );
  await vi.advanceTimersByTimeAsync(3000);
  await expect(pending).resolves.toBe("navigated");
});

it.each([
  "javascript:alert(1)",
  "http://return.example/callback",
  "bad URL",
  "https://user:pass@return.example/cb",
])("never navigates an invalid callback: %s", async (callback) => {
  const f = fixture();
  const pending = f.complete(callback);
  await vi.advanceTimersByTimeAsync(3000);
  await expect(pending).resolves.toBe("unavailable");
  expect(f.state.location.replace).not.toHaveBeenCalled();
});
