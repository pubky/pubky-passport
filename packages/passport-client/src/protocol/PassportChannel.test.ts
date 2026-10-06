import { afterEach, expect, test, vi } from "vitest";
import { FakeClock } from "../../test/FakeClock.js";
import { FakePopupWindow } from "../../test/FakePopupPort.js";
import { AttemptController } from "../attempt/AttemptController.js";
import type { AttemptCommand } from "../attempt/AttemptEffectPort.js";
import { resolveClientOptions } from "../config/resolveClientOptions.js";
import { BrowserPopup } from "../popup/BrowserPopup.js";
import { createRingLink } from "../shared/RingLink.js";
import { PassportChannel, type ChannelObserver } from "./PassportChannel.js";
import { startAttempt } from "../../test/startAttempt.js";

const ATTEMPT = "abcdefghijklmnopqrstuv";
const ORIGIN = "https://passport.example";
const OTHER = "https://custom.example";
const CANARY = ["private", "channel", "material"].join("_");
const ready = (status = "valid", code?: string) => ({
  type: "pubky-passport.ready",
  version: 2,
  attemptId: ATTEMPT,
  protocols: [1, 2],
  features: ["outcome-v2", "status"],
  request: { status, ...(code ? { code } : {}) },
});
const outcome = (version = 2, messageId = "outcome-one", value = "success") => ({
  type: "pubky-passport.authorization-outcome",
  version,
  ...(version === 2 ? { attemptId: ATTEMPT } : {}),
  messageId,
  outcome: value,
});
const REQUEST_DIGEST = "q".repeat(43);
const hello = (profile = "required") => ({
  type: "pubky-passport.hello",
  version: 2,
  attemptId: ATTEMPT,
  features: ["outcome-v2", "status"],
  profile,
  network: "mainnet",
  request: REQUEST_DIGEST,
});
const resources: {
  channel: PassportChannel;
  port: BrowserPopup;
  clock: FakeClock;
  fake: FakePopupWindow;
}[] = [];
function messageEvent(data: unknown, origin: string, source: MessageEventSource | null) {
  const event = new MessageEvent("message", { data, origin });
  // Assign after construction: jsdom's IDL converter inspects a Window implementation symbol.
  Object.defineProperty(event, "source", { value: source });
  return event;
}
function setup(
  profile: "required" | "optional" = "required",
  overrides: Partial<ChannelObserver> = {},
) {
  const fake = new FakePopupWindow();
  const clock = new FakeClock();
  const event = vi.fn<ChannelObserver["event"]>();
  const diagnostic = vi.fn<NonNullable<ChannelObserver["diagnostic"]>>();
  const failed = vi.fn<NonNullable<ChannelObserver["failed"]>>();
  const port = new BrowserPopup(() => window, undefined, clock);
  const readWindow = vi.fn(() => window);
  const channel = new PassportChannel(
    ATTEMPT,
    profile,
    port,
    { event, diagnostic, failed, ...overrides },
    readWindow,
    clock,
  );
  const receive = (
    data: unknown,
    origin = ORIGIN,
    source: MessageEventSource | null = fake.window,
  ) => window.dispatchEvent(messageEvent(data, origin, source));
  const h = { fake, clock, event, diagnostic, failed, port, channel, readWindow, receive };
  resources.push(h);
  return h;
}
afterEach(() => {
  const owned = resources.splice(0);
  for (const h of owned) {
    h.channel.dispose();
    h.port.dispose();
  }
  vi.restoreAllMocks();
  for (const h of owned) {
    h.clock.assertEmpty();
    h.fake.assertHealthy();
  }
});

test("a testnet client names its network in every hello", () => {
  const fake = new FakePopupWindow();
  const clock = new FakeClock();
  const channel = new PassportChannel(
    ATTEMPT,
    "required",
    new BrowserPopup(() => window, undefined, clock),
    { event: vi.fn() },
    () => window,
    clock,
    "testnet",
  );
  channel.startHandshake(fake.window, ORIGIN, REQUEST_DIGEST);
  clock.advance(250);
  expect(fake.posts.map(({ message }) => message)).toEqual([
    { ...hello(), network: "testnet" },
    { ...hello(), network: "testnet" },
  ]);
  channel.dispose();
});

test.each(["required", "optional"] as const)(
  "sends the %s hello immediately to the pinned origin with lazy browser access",
  (profile) => {
    const h = setup(profile);
    expect(h.readWindow).not.toHaveBeenCalled();
    h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
    expect(h.fake.posts).toEqual([{ message: hello(profile), origin: ORIGIN }]);
    expect(h.event).not.toHaveBeenCalled();
    h.clock.advance(249);
    expect(h.fake.posts).toHaveLength(1);
    h.clock.advance(1);
    expect(h.fake.posts).toHaveLength(2);
  },
);
test("changes 250ms handshake to 1s then 2s heartbeat without treating silence as failure", () => {
  const h = setup();
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  h.clock.advance(500);
  expect(h.fake.posts).toHaveLength(3);
  h.channel.slowHandshake();
  h.clock.advance(999);
  expect(h.fake.posts).toHaveLength(3);
  h.clock.advance(1);
  expect(h.fake.posts).toHaveLength(4);
  h.channel.stopHandshake();
  h.clock.assertEmpty();
  h.channel.startHeartbeat();
  h.channel.stopHandshake();
  h.clock.advance(1999);
  expect(h.fake.posts).toHaveLength(4);
  h.clock.advance(1);
  expect(h.fake.posts).toHaveLength(5);
  h.clock.advance(12000);
  expect(h.fake.posts).toHaveLength(11);
  expect(h.failed).not.toHaveBeenCalled();
  expect(h.diagnostic).not.toHaveBeenCalled();
  h.channel.stopHeartbeat();
  h.clock.assertEmpty();
});
test("checks origin before source or schema and source before schema", () => {
  const h = setup();
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  const reads: string[] = [];
  const data = Object.defineProperty({ type: "pubky-passport.ready" }, "version", {
    get() {
      reads.push("schema");
      return 2;
    },
  });
  const message = new MessageEvent("message", { data });
  Object.defineProperties(message, {
    origin: {
      get() {
        reads.push("origin");
        return OTHER;
      },
    },
    source: {
      get() {
        reads.push("source");
        return h.fake.window;
      },
    },
  });
  window.dispatchEvent(message);
  expect(reads).toEqual(["origin"]);
  h.receive(data, ORIGIN, window);
  expect(reads).toEqual(["origin"]);
  expect(h.diagnostic.mock.calls).toEqual([
    [{ code: "message_ignored", reason: "origin", attemptId: ATTEMPT }],
    [{ code: "message_ignored", reason: "source", attemptId: ATTEMPT }],
  ]);
  expect(h.event).not.toHaveBeenCalled();
});
test.each([
  ["origin", () => ready(), OTHER],
  ["schema", () => ({ ...ready(), protocols: [2] }), ORIGIN],
  ["attempt", () => ({ ...ready(), attemptId: "other-attempt-123456" }), ORIGIN],
] as const)("reports only trusted diagnostic fields for rejected %s", (reason, message, origin) => {
  const h = setup();
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  h.receive({ ...message(), secret: CANARY }, origin);
  expect(h.diagnostic).toHaveBeenCalledExactlyOnceWith({
    code: "message_ignored",
    reason,
    attemptId: ATTEMPT,
  });
  expect(h.event).not.toHaveBeenCalled();
  expect(h.fake.posts).toHaveLength(1);
  expect(JSON.stringify(h.diagnostic.mock.calls)).not.toContain(CANARY);
});
test("ignores unrelated messages and hostile message getters without throwing or retaining input", () => {
  const h = setup();
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  const trap = () => {
    throw new Error(CANARY);
  };
  for (const data of [
    null,
    {},
    { type: "other.event", secret: CANARY },
    new Proxy({}, { get: trap }),
  ]) {
    expect(() => h.receive(data)).not.toThrow();
    h.receive(data, OTHER);
  }
  const message = new MessageEvent("message");
  Object.defineProperty(message, "origin", { get: trap });
  expect(() => window.dispatchEvent(message)).not.toThrow();
  expect(h.event).not.toHaveBeenCalled();
  expect(h.diagnostic).not.toHaveBeenCalled();
});
test.each(["valid", "invalid", "empty", "expired", "completed"])(
  "forwards only normalized READY %s",
  (status) => {
    const h = setup();
    h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
    h.receive({ ...ready(status, CANARY), secret: CANARY });
    expect(h.event).toHaveBeenCalledExactlyOnceWith({ type: "READY", status });
    expect(JSON.stringify(h.event.mock.calls)).not.toContain(CANARY);
  },
);
test("forwards known request and approval codes and the two status phases", () => {
  const h = setup();
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  h.receive(ready("invalid", "history_unavailable"));
  expect(h.event).toHaveBeenLastCalledWith({
    type: "READY",
    status: "invalid",
    code: "history_unavailable",
  });
  for (const phase of ["ring", "granting"]) {
    h.receive({ type: "pubky-passport.status", version: 2, attemptId: ATTEMPT, phase });
    expect(h.event).toHaveBeenLastCalledWith({ type: "STATUS", phase });
  }
  h.receive({ ...outcome(2, "error", "error"), code: "relay_unreachable" });
  expect(h.event).toHaveBeenLastCalledWith({
    type: "OUTCOME",
    version: 2,
    messageId: "error",
    outcome: "error",
    code: "relay_unreachable",
  });
});
test.each([
  { label: "completed phase", fields: { phase: "completed" }, valid: false },
  { label: "completed request only", fields: { request: { status: "completed" } }, valid: false },
  {
    label: "ring with unknown completed request",
    fields: { phase: "ring", request: { status: "completed" } },
    valid: true,
  },
])("a status with $label cannot end a waiting attempt", async ({ fields, valid }) => {
  const instance = {
    origin: ORIGIN,
    host: "passport.example",
    isCustom: false,
  };
  let snapshot = 0;
  const event = vi.fn<ChannelObserver["event"]>((value) => controller.dispatch(value));
  const h = setup("required", { event });
  const run = vi.fn<(command: AttemptCommand) => void>();
  const controller = new AttemptController(
    instance,
    () => ({
      defaultInstance: instance,
      attemptId: snapshot++ === 0 ? ATTEMPT : `context-${snapshot}`,
      now: h.clock.now(),
      leases: 0,
      visible: true,
      profile: "optional" as const,
      timeouts: resolveClientOptions({}, (value) => value).timeouts,
    }),
    { run, dispose: () => {} },
    undefined,
    h.clock,
  );
  const session = vi.fn();
  controller.onSession(session);
  const pending = startAttempt(controller, { type: "SIGN_IN", instance, popup: h.fake.window });
  try {
    controller.dispatch({
      type: "FLOW_CREATED",
      flowId: 1,
      ringLink: createRingLink(() => CANARY),
    });
    h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
    h.receive(ready());
    const before = controller.getState();
    expect(before).toMatchObject({ status: "waiting", attemptId: ATTEMPT });
    event.mockClear();
    run.mockClear();
    h.receive({ type: "pubky-passport.status", version: 2, attemptId: ATTEMPT, ...fields });
    if (valid) {
      expect(event).toHaveBeenCalledExactlyOnceWith({ type: "STATUS", phase: "ring" });
      expect(h.diagnostic).not.toHaveBeenCalled();
      expect(controller.getState()).toMatchObject({ ...before, phase: "ring" });
    } else {
      expect(event).not.toHaveBeenCalled();
      expect(controller.getState()).toBe(before);
      expect(h.diagnostic).toHaveBeenCalledExactlyOnceWith({
        code: "message_ignored",
        reason: "schema",
        attemptId: ATTEMPT,
      });
    }
    expect(run.mock.calls.flat().some((command) => command.type === "EndAttempt")).toBe(false);
    expect(session).not.toHaveBeenCalled();
  } finally {
    controller.dispose();
    await pending;
  }
});
test.each([1, 2] as const)(
  "processes the first v%s outcome and only acknowledges later outcomes, including different IDs",
  (version) => {
    const h = setup();
    h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
    h.receive(outcome(version));
    expect(h.event).toHaveBeenCalledExactlyOnceWith({
      type: "OUTCOME",
      version,
      messageId: "outcome-one",
      outcome: "success",
    });
    expect(h.fake.posts).toHaveLength(1);
    h.channel.ack("outcome-one", version);
    h.receive(outcome(version));
    h.receive(outcome(version, "second", "cancel"));
    expect(h.event).toHaveBeenCalledOnce();
    expect(h.fake.posts.slice(1)).toEqual(
      ["outcome-one", "outcome-one", "second"].map((messageId) => ({
        origin: ORIGIN,
        message: {
          type: "pubky-passport.authorization-outcome-ack",
          version,
          messageId,
          ...(version === 2 ? { attemptId: ATTEMPT } : {}),
        },
      })),
    );
    if (version === 1)
      expect(h.diagnostic).toHaveBeenCalledWith({
        code: "passport_protocol_v1",
        attemptId: ATTEMPT,
      });
    else expect(h.diagnostic).not.toHaveBeenCalled();
  },
);
test("rebinding retains one listener and outcome authority while rejecting both old source and old origin", () => {
  const h = setup();
  const other = new FakePopupWindow();
  const add = vi.spyOn(window, "addEventListener");
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  h.receive(outcome());
  h.channel.startHandshake(other.window, OTHER, REQUEST_DIGEST);
  h.receive(outcome());
  h.receive(outcome(), OTHER);
  h.receive(outcome(2, "new", "cancel"), OTHER, other.window);
  expect(add.mock.calls.filter(([type]) => type === "message")).toHaveLength(1);
  expect(h.event).toHaveBeenCalledOnce();
  expect(h.diagnostic.mock.calls.map(([d]) => d.reason)).toEqual(["origin", "source"]);
  expect(other.posts).toEqual([
    { origin: OTHER, message: hello() },
    {
      origin: OTHER,
      message: {
        type: "pubky-passport.authorization-outcome-ack",
        version: 2,
        attemptId: ATTEMPT,
        messageId: "new",
      },
    },
  ]);
  other.assertHealthy();
});
test("dispose and loop replacement invalidate queued callbacks before cleanup", () => {
  const h = setup();
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  const listener = add.mock.calls.find(([name]) => name === "message")![1] as (
    event: MessageEvent,
  ) => void;
  const stale = h.clock.captured[0]!;
  h.channel.slowHandshake();
  stale();
  expect(h.fake.posts).toHaveLength(1);
  h.channel.dispose();
  h.channel.dispose();
  for (const callback of h.clock.captured) callback();
  listener(messageEvent(ready(), ORIGIN, h.fake.window));
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  h.channel.startHeartbeat();
  h.channel.slowHandshake();
  h.channel.ack("after", 2);
  expect(remove).toHaveBeenCalledWith("message", listener);
  expect(h.fake.posts).toHaveLength(1);
  expect(h.event).not.toHaveBeenCalled();
  h.clock.assertEmpty();
});
test("post failures cannot end polling authority or escape through callbacks", () => {
  const h = setup();
  h.fake.failure = "postMessage";
  expect(() => h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST)).not.toThrow();
  h.clock.advance(1000);
  h.channel.ack("x", 2);
  expect(h.failed).not.toHaveBeenCalled();
  expect(h.event).not.toHaveBeenCalled();
  h.fake.failure = undefined;
  h.receive(ready());
  expect(h.event).toHaveBeenCalledWith({ type: "READY", status: "valid" });
});
test("listener installation failure removes its partial registration before throwing internally", () => {
  const h = setup();
  const remove = vi.spyOn(window, "removeEventListener");
  vi.spyOn(window, "addEventListener").mockImplementation(() => {
    throw new Error(CANARY);
  });
  expect(() => h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST)).toThrow();
  expect(remove).toHaveBeenCalledWith("message", expect.any(Function));
  h.clock.assertEmpty();
});
test("initial scheduler failure cleans up; later failure stops the loop and reports through its internal hook", () => {
  const h = setup();
  const schedule = vi.spyOn(h.clock, "schedule").mockImplementation(() => {
    throw new Error(CANARY);
  });
  expect(() => h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST)).toThrow();
  h.clock.assertEmpty();
  h.receive(ready());
  expect(h.event).not.toHaveBeenCalled();
  schedule.mockRestore();
  const later = setup();
  later.channel.startHandshake(later.fake.window, ORIGIN, REQUEST_DIGEST);
  vi.spyOn(later.clock, "schedule").mockImplementation(() => {
    throw new Error(CANARY);
  });
  expect(() => later.clock.advance(250)).not.toThrow();
  expect(later.failed).toHaveBeenCalledOnce();
  later.clock.assertEmpty();
});
test.each([false, true])(
  "observer failures are contained without duplicate processing (async=%s)",
  async (asynchronous) => {
    const observer = vi.fn(() => {
      if (asynchronous) return Promise.reject(new Error(CANARY));
      throw new Error(CANARY);
    });
    const h = setup("required", { event: observer, diagnostic: observer });
    h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
    h.receive(ready(), OTHER);
    h.receive(outcome());
    h.receive(outcome());
    await Promise.resolve();
    await Promise.resolve();
    expect(observer).toHaveBeenCalledTimes(2);
    expect(h.fake.posts).toHaveLength(2);
  },
);
test("a reentrant diagnostic can dispose before a v1 outcome is processed", () => {
  const diagnostic = vi.fn(() => h.channel.dispose());
  const h = setup("required", { diagnostic });
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  h.receive(outcome(1));
  expect(diagnostic).toHaveBeenCalledOnce();
  expect(h.event).not.toHaveBeenCalled();
  h.clock.assertEmpty();
});
test("a reentrant parser getter cannot deliver an old binding's message after rebinding", () => {
  const h = setup();
  const other = new FakePopupWindow();
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  const message = Object.defineProperty(ready(), "version", {
    get() {
      h.channel.startHandshake(other.window, OTHER, REQUEST_DIGEST);
      return 2;
    },
  });
  h.receive(message);
  expect(h.event).not.toHaveBeenCalled();
  h.receive(ready(), OTHER, other.window);
  expect(h.event).toHaveBeenCalledExactlyOnceWith({ type: "READY", status: "valid" });
  other.assertHealthy();
});
test("a synchronous reply during hello can switch to heartbeat without reviving the handshake", () => {
  const h = setup("required", { event: () => h.channel.startHeartbeat() });
  vi.spyOn(h.port, "post").mockImplementationOnce(() => {
    h.receive(ready());
    return true;
  });
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  h.clock.advance(1999);
  expect(h.fake.posts).toHaveLength(0);
  h.clock.advance(1);
  expect(h.fake.posts).toHaveLength(1);
  expect(h.clock.pending.size).toBe(1);
});

test("the first outcome keeps authority when its v1 diagnostic delivers a later outcome reentrantly", () => {
  const diagnostic = vi.fn().mockImplementationOnce(() => h.receive(outcome(2, "later", "cancel")));
  const h = setup("required", { diagnostic });
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  h.receive(outcome(1));
  expect(h.event).toHaveBeenCalledExactlyOnceWith({
    type: "OUTCOME",
    version: 1,
    messageId: "outcome-one",
    outcome: "success",
  });
  expect(h.fake.posts.at(-1)).toEqual({
    origin: ORIGIN,
    message: {
      type: "pubky-passport.authorization-outcome-ack",
      version: 2,
      attemptId: ATTEMPT,
      messageId: "later",
    },
  });
});
test("stopping heartbeat leaves a handshake running and stopping both loops keeps the outcome listener", () => {
  const h = setup();
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  h.channel.stopHeartbeat();
  h.clock.advance(250);
  expect(h.fake.posts).toHaveLength(2);
  h.channel.stopHandshake();
  h.channel.stopHeartbeat();
  h.clock.assertEmpty();
  h.receive(outcome());
  expect(h.event).toHaveBeenCalledExactlyOnceWith({
    type: "OUTCOME",
    version: 2,
    messageId: "outcome-one",
    outcome: "success",
  });
});

test("unbinding stops every reply and timer until a rebind, preserving first-outcome authority", () => {
  const h = setup();
  const other = new FakePopupWindow();
  const add = vi.spyOn(window, "addEventListener");
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  h.receive(outcome());
  h.channel.unbind();
  for (const callback of h.clock.captured) callback();
  h.receive(ready());
  h.receive(outcome());
  h.channel.ack("while-unbound", 2);
  h.channel.startHeartbeat();
  h.clock.assertEmpty();
  expect(h.fake.posts).toHaveLength(1);
  expect(h.event).toHaveBeenCalledOnce();
  h.channel.startHandshake(other.window, OTHER, REQUEST_DIGEST);
  h.receive(outcome(2, "later", "cancel"), OTHER, other.window);
  expect(h.event).toHaveBeenCalledOnce();
  expect(other.posts.at(-1)).toMatchObject({ origin: OTHER, message: { messageId: "later" } });
  expect(add.mock.calls.filter(([type]) => type === "message")).toHaveLength(1);
  other.assertHealthy();
});

test("a ready that offers profile setup says so; one that does not, does not", () => {
  const h = setup();
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  h.receive({ ...ready(), features: ["outcome-v2", "status", "profile-setup"] });
  h.receive(ready());
  expect(h.event.mock.calls.map(([event]) => event)).toEqual([
    { type: "READY", status: "valid", profileSetup: true },
    { type: "READY", status: "valid" },
  ]);
});

test("profile-needed goes to the bound Passport only, naming the attempt and the key", () => {
  const h = setup();
  h.channel.profileNeeded("approved-key");
  expect(h.fake.posts).toEqual([]);
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  h.channel.stopHandshake();
  h.channel.profileNeeded("approved-key");
  expect(h.fake.posts.at(-1)).toEqual({
    message: {
      type: "pubky-passport.profile-needed",
      version: 2,
      attemptId: ATTEMPT,
      publicKey: "approved-key",
    },
    origin: ORIGIN,
  });
});

test("profile-ready counts only from the bound window, origin and attempt", () => {
  const h = setup();
  h.channel.startHandshake(h.fake.window, ORIGIN, REQUEST_DIGEST);
  const message = { type: "pubky-passport.profile-ready", version: 2, attemptId: ATTEMPT };
  h.receive(message, OTHER);
  h.receive(message, ORIGIN, null);
  h.receive({ ...message, attemptId: "z".repeat(22) });
  h.receive({ ...message, version: 1 });
  expect(h.event).not.toHaveBeenCalled();
  h.receive(message);
  expect(h.event).toHaveBeenCalledExactlyOnceWith({ type: "PROFILE_READY" });
});

test("the profile page's hello names its key instead of a request", () => {
  const h = setup();
  h.channel.startProfileHandshake(h.fake.window, ORIGIN, "approved-key");
  expect(h.fake.posts).toEqual([
    {
      message: {
        type: "pubky-passport.hello",
        version: 2,
        attemptId: ATTEMPT,
        features: ["outcome-v2", "status"],
        profile: "required",
        network: "mainnet",
        profileKey: "approved-key",
      },
      origin: ORIGIN,
    },
  ]);
});
