import { afterEach, expect, test, vi } from "vitest";
import { FakeClock } from "../../test/FakeClock.js";
import { FakeFlowPort } from "../../test/FakeFlowPort.js";
import { FakePopupWindow } from "../../test/FakePopupPort.js";
import { FakeSession } from "../../test/FakeSession.js";
import { AttemptController } from "../attempt/AttemptController.js";
import { AttemptEffects } from "../attempt/AttemptEffects.js";
import { resolveClientOptions } from "../config/resolveClientOptions.js";
import { PassportError } from "../errors/PassportError.js";
import type { FlowHandle, FlowResult } from "../flow/FlowPort.js";
import { FlowRegistry } from "../flow/FlowRegistry.js";
import type { PassportInstance } from "../instance/PassportInstance.js";
import { BrowserPopup } from "../popup/BrowserPopup.js";
import { PopupActions } from "./PopupActions.js";

const DEFAULT: PassportInstance = {
  origin: "https://default.example",
  host: "default.example",
  isCustom: false,
};
const CUSTOM: PassportInstance = {
  origin: "https://custom.example",
  host: "custom.example",
  isCustom: true,
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const resources: { finish(): Promise<void> }[] = [];
afterEach(async () => {
  try {
    for (const h of resources.splice(0)) await h.finish();
  } finally {
    vi.restoreAllMocks();
  }
});
function setup(selection = DEFAULT) {
  const clock = new FakeClock();
  let nextId = 0;
  const context = {
    defaultInstance: DEFAULT,
    attemptId: "lease-context",
    now: 0,
    leases: 0,
    visible: true,
    profile: "optional" as const,
    timeouts: resolveClientOptions({}, (v) => v).timeouts,
  };
  const requests: { flow: FakeFlowPort; instance: PassportInstance; resolve(): void }[] = [];
  const windows: FakePopupWindow[] = [];
  const results: (Window | null | undefined)[] = [];
  const sessions: FakeSession[] = [];
  const delivered = new Set<unknown>();
  const received = vi.fn((session) => {
    delivered.add(session);
  });
  const diagnostic = vi.fn();
  const redirect = vi.fn();
  const native = vi.fn<(...args: string[]) => Window | null | undefined>(() => results.shift());
  const popup = new BrowserPopup(() => window, native, clock);
  const flows = new FlowRegistry(
    (instance) => ({
      start: vi.fn(() => {
        let resolve!: (value: FlowResult<FlowHandle>) => void;
        const pending = new Promise<FlowResult<FlowHandle>>((settle) => {
          resolve = settle;
        });
        const flow = new FakeFlowPort(
          `pubkyauth://${["private", instance.host, requests.length].join("-")}`,
        );
        requests.push({ flow, instance, resolve: () => resolve({ ok: true, value: flow }) });
        return pending;
      }),
      resume: () => {
        throw new Error("Not a return test");
      },
    }),
    {
      event: (event) => controller.dispatch(event),
      session: (flowId, session) =>
        controller.receiveSession(flowId, session, {
          publicKey: "approved-key",
          capabilities: [],
          capabilitiesMatch: true,
        }),
      diagnostic,
    },
    clock,
  );
  const effects = new AttemptEffects({
    flows,
    popup,
    profile: "optional" as const,
    readProfile: async () => ({ kind: "missing" }),
    clock,
    redirect,
    returnCallbacks: (attemptId) => ({
      xSuccess: `https://app.example/?pubky-passport=s.${attemptId}`,
      xError: `https://app.example/?pubky-passport=e.${attemptId}`,
      xCancel: `https://app.example/?pubky-passport=c.${attemptId}`,
    }),
    diagnostic,
    event: (event) => controller.dispatch(event),
    failed: (cause) =>
      controller.dispatch({
        type: "RUNTIME_FAILED",
        error: new PassportError("internal", { cause }),
      }),
  });
  const readContext = vi.fn(() => ({ ...context, now: clock.now() }));
  const controller = new AttemptController(selection, readContext, effects, diagnostic, clock);
  controller.onSession(received);
  const options = {
    controller,
    popup,
    flows,
    defaultInstance: DEFAULT,
    instance: () => selection,
    nextAttemptId: () => {
      context.attemptId = `attempt-${++nextId}`;
      return context.attemptId;
    },
    environment: () => ({
      topLevel: true,
      protocol: "https:",
      storageWritable: true,
      inApp: false,
      iosStandalone: false,
      crossOriginIsolated: false,
      userActivation: true,
    }),
    diagnostic,
  };
  const actions = new PopupActions(options);
  const live = () => {
    const fake = new FakePopupWindow();
    fake.documentAllowed = true;
    windows.push(fake);
    results.push(fake.window);
    return fake;
  };
  const created = async (index = 0) => {
    requests[index]!.resolve();
    await flush();
  };
  const session = () => {
    const fake = new FakeSession();
    sessions.push(fake);
    return fake;
  };
  const h = {
    actions,
    controller,
    options,
    context,
    flows,
    popup,
    requests,
    results,
    live,
    native,
    created,
    clock,
    diagnostic,
    redirect,
    received,
    session,
    readContext,
    async finish() {
      controller.dispose();
      for (const request of requests) request.resolve();
      await flush();
      for (const request of requests) if (request.flow.pending) request.flow.settle();
      await flush();
      for (const fake of sessions) {
        if (delivered.has(fake.session) && !fake.frees) fake.session.free();
        fake.assertFreed();
      }
      for (const { flow } of requests) flow.assertFreed();
      for (const fake of windows) fake.assertHealthy();
      clock.assertEmpty();
    },
  };
  resources.push(h);
  return h;
}

test("native opening reserves the same reentrant promise before creating a flow", async () => {
  const h = setup();
  const fake = h.live();
  let reentrant: ReturnType<typeof h.actions.signIn> | undefined;
  let requestsAtOpen = -1;
  h.native.mockImplementationOnce(() => {
    requestsAtOpen = h.requests.length;
    reentrant = h.actions.signIn();
    return h.results.shift();
  });
  const promise = h.actions.signIn();
  expect(reentrant).toBe(promise);
  expect(requestsAtOpen).toBe(0);
  expect(h.native).toHaveBeenCalledOnce();
  expect(h.native.mock.calls[0]![1]).toBe("pubky-passport-attempt-1");
  expect(h.controller.getState()).toMatchObject({ status: "opening", attemptId: "attempt-1" });
  expect(h.actions.signIn()).toBe(promise);
  expect(fake.focusCalls).toBe(2);
  expect(h.requests).toHaveLength(1);
  await h.created();
  h.requests[0]!.flow.settle(h.session().session);
  await flush();
  expect((await promise).status).toBe("signed-in");
  expect(fake.closed).toBe(true);
  expect(h.received).toHaveBeenCalledOnce();
});

test.each(["cancel", "dispose"] as const)(
  "%s inside native open settles the reserved result and closes the unclaimed window",
  async (action) => {
    const h = setup();
    const fake = h.live();
    h.native.mockImplementationOnce(() => {
      h.controller[action]();
      return h.results.shift();
    });
    expect(await h.actions.signIn()).toMatchObject({
      status: "failed",
      error: { code: "cancelled", detail: { by: "app" } },
    });
    expect(fake.closeCalls).toBe(1);
    expect(h.requests).toHaveLength(0);
    expect(h.controller.getState().status).toBe("idle");
  },
);

test("windowless opening ignores focus and repeated signIn until detached, then adopts its first Session", async () => {
  const h = setup();
  h.results.push(undefined, null);
  const promise = h.actions.signIn();
  h.actions.focus();
  expect(h.actions.signIn()).toBe(promise);
  expect(h.native).toHaveBeenCalledTimes(2);
  expect(h.controller.getState().status).toBe("opening");
  expect(h.redirect).not.toHaveBeenCalled();
  await h.created();
  expect(h.controller.getState()).toMatchObject({ status: "detached", reason: "unreachable" });
  h.requests[0]!.flow.settle(h.session().session);
  await flush();
  expect((await promise).status).toBe("signed-in");
});

test.each(["reopen", "focus", "useDefaultInstance"] as const)(
  "undefined then undefined %s dispatches nothing and retains the pending result",
  async (action) => {
    const h = setup(CUSTOM);
    const first = h.live();
    const promise = h.actions.signIn();
    await h.created();
    h.controller.dispatch({ type: "READY", status: "valid" });
    if (action === "focus") first.closed = true;
    const before = h.controller.snapshot();
    h.results.push(undefined, undefined);
    h.actions[action]();
    expect(h.controller.snapshot()).toBe(before);
    expect(h.controller.reservedResult()).toBe(promise);
    expect(h.requests).toHaveLength(1);
    expect(h.native).toHaveBeenCalledTimes(3);
    expect(h.redirect).not.toHaveBeenCalled();
    expect(h.native.mock.calls[2]![1]).toBe("_blank");
  },
);

test("reopen replaces the window with the same pinned URL and a new generation", async () => {
  const h = setup(CUSTOM);
  const first = h.live();
  const promise = h.actions.signIn();
  await h.created();
  h.controller.dispatch({ type: "READY", status: "valid" });
  const next = h.live();
  h.actions.reopen();
  expect(first.closed).toBe(true);
  expect(next.closed).toBe(false);
  expect(h.native.mock.calls[1]![0]).toBe(
    CUSTOM.origin + "/authorize#d=" + encodeURIComponent(h.requests[0]!.flow.url),
  );
  expect(h.native.mock.calls[1]![1]).toBe("pubky-passport-attempt-1-r1");
  expect(h.controller.reservedResult()).toBe(promise);
  expect(h.requests).toHaveLength(1);
});

test.each(["waiting", "detached", "failed"] as const)(
  "use default from %s creates a fresh D flow and never reads C's URL",
  async (from) => {
    const h = setup(CUSTOM);
    h.live();
    const first = h.actions.signIn();
    await h.created();
    if (from === "detached") h.controller.dispatch({ type: "POPUP_CLOSED" });
    else h.controller.dispatch({ type: "READY", status: "valid" });
    if (from === "failed") {
      h.controller.dispatch({ type: "ATTEMPT_TIMEOUT" });
      await first;
    }
    const url = vi.spyOn(h.flows, "authorizationUrl");
    const popup = h.live();
    h.actions.useDefaultInstance();
    expect(url).not.toHaveBeenCalled();
    expect(h.native.mock.calls[1]![0]).toBe("about:blank");
    expect(h.native.mock.calls[1]![1]).toBe(
      from === "failed" ? "pubky-passport-attempt-2" : "pubky-passport-attempt-1-r1",
    );
    expect(h.requests[1]!.instance).toBe(DEFAULT);
    expect(h.options.instance()).toBe(CUSTOM);
    await h.created(1);
    expect(popup.navigations).toEqual([
      DEFAULT.origin + "/authorize#d=" + encodeURIComponent(h.requests[1]!.flow.url),
    ]);
  },
);

test("a context failure after opening closes the unclaimed window and returns only a safe error", async () => {
  const h = setup();
  const fake = h.live();
  const canary = ["private", "context", "error"].join("-");
  h.readContext.mockImplementation(() => {
    throw new Error(canary);
  });
  const result = await h.actions.signIn();
  expect(result).toMatchObject({
    status: "failed",
    error: { code: "internal", cause: { message: "UnknownError" } },
  });
  expect(JSON.stringify(result)).not.toContain(canary);
  expect(fake.closeCalls).toBe(1);
  expect(h.requests).toHaveLength(0);
  h.readContext.mockImplementation(() => ({ ...h.context, now: h.clock.now() }));
});

test("disposal refuses new calls without opening or dispatching a new flow", async () => {
  const h = setup(CUSTOM);
  h.controller.dispose();
  expect(await h.actions.signIn()).toMatchObject({ status: "failed", error: { code: "internal" } });
  h.actions.focus();
  h.actions.reopen();
  h.actions.useDefaultInstance();
  expect(h.native).not.toHaveBeenCalled();
  expect(h.requests).toHaveLength(0);
});

test("a prepared URL is read only after both model and registry pins match the chosen instance", async () => {
  const h = setup(CUSTOM);
  h.context.leases = 1;
  h.controller.dispatch({ type: "PREPARE" });
  await h.created();
  const read = vi.spyOn(h.flows, "authorizationUrl");
  vi.spyOn(h.flows, "instance").mockReturnValue(DEFAULT);
  expect(await h.actions.signIn()).toMatchObject({ status: "failed", error: { code: "internal" } });
  expect(read).not.toHaveBeenCalled();
  expect(h.native).not.toHaveBeenCalled();
});

test("changed selection leaves a foreign prepared URL unread and opens a fresh blank window", async () => {
  const h = setup(CUSTOM);
  h.context.leases = 1;
  h.controller.dispatch({ type: "PREPARE" });
  await h.created();
  h.options.instance = () => DEFAULT;
  const read = vi.spyOn(h.flows, "authorizationUrl");
  h.live();
  h.actions.signIn();
  expect(read).not.toHaveBeenCalled();
  expect(h.native.mock.calls[0]![0]).toBe("about:blank");
  expect(h.requests).toHaveLength(2);
  expect(h.requests[1]!.instance).toBe(DEFAULT);
});

test.each(["throw", "reject", "cancel"] as const)(
  "an activation diagnostic observer can %s only after the window is owned",
  async (action) => {
    const h = setup();
    const environment = h.options.environment();
    h.options.environment = () => ({ ...environment, userActivation: false });
    const popup = h.live();
    const owned: boolean[] = [];
    h.diagnostic.mockImplementation(() => {
      owned.push(h.controller.snapshot().popup === popup.window);
      if (action === "cancel") h.controller.cancel();
      if (action === "reject") return Promise.reject(new Error("Observer rejected"));
      if (action === "throw") throw new Error("Observer threw");
      return undefined;
    });
    const promise = h.actions.signIn();
    await flush();
    expect(owned).toEqual([true]);
    expect(h.diagnostic).toHaveBeenCalledExactlyOnceWith({
      code: "no_user_activation",
      attemptId: "attempt-1",
    });
    if (action === "cancel") {
      expect((await promise).status).toBe("failed");
      expect(popup.closed).toBe(true);
    } else expect(h.controller.getState().status).toBe("opening");
  },
);

test("a runtime fault during Reopen ends the owned attempt and closes its old window", async () => {
  const h = setup(CUSTOM);
  const first = h.live();
  const promise = h.actions.signIn();
  await h.created();
  h.controller.dispatch({ type: "READY", status: "valid" });
  vi.spyOn(h.flows, "instance").mockReturnValue(DEFAULT);
  h.actions.reopen();
  expect(await promise).toMatchObject({ status: "failed", error: { code: "internal" } });
  expect(h.controller.getState()).toMatchObject({ status: "failed", error: { code: "internal" } });
  expect(first.closed).toBe(true);
  expect(h.native).toHaveBeenCalledOnce();
  h.requests[0]!.flow.settle();
  await flush();
  expect(h.requests[0]!.flow.frees).toBe(1);
});

test("a prepared Session delivered inside native open cannot strand its window or overwrite a reentrant attempt", async () => {
  const h = setup();
  h.context.leases = 1;
  h.controller.dispatch({ type: "PREPARE" });
  await h.created();
  const first = h.live();
  const second = h.live();
  const accepted = h.session();
  let next: ReturnType<typeof h.actions.signIn> | undefined;
  h.controller.onSession(() => {
    next = h.actions.signIn();
  });
  h.native.mockImplementationOnce(() => {
    const opened = h.results.shift();
    h.controller.receiveSession(1, accepted.session, {
      publicKey: "approved-key",
      capabilities: [],
      capabilitiesMatch: true,
    });
    return opened;
  });
  const original = h.actions.signIn();
  expect((await original).status).toBe("signed-in");
  expect(h.received).toHaveBeenCalledOnce();
  expect(first.closed).toBe(true);
  expect(second.closed).toBe(false);
  expect(h.native.mock.calls.map((call) => call[1])).toEqual([
    "pubky-passport-attempt-1",
    "pubky-passport-attempt-2",
  ]);
  expect(h.controller.getState()).toMatchObject({ status: "opening", attemptId: "attempt-2" });
  expect(h.controller.reservedResult()).toBe(next);
  const settled = vi.fn();
  void next!.then(settled);
  await flush();
  expect(settled).not.toHaveBeenCalled();
  h.context.leases = 0;
  h.controller.cancel();
  expect(await next).toMatchObject({ status: "failed", error: { code: "cancelled" } });
});

test("a closed window before flow creation opens nothing until the watcher fails the attempt", async () => {
  const h = setup();
  const first = h.live();
  const promise = h.actions.signIn();
  first.closed = true;
  h.actions.focus();
  expect(h.actions.signIn()).toBe(promise);
  expect(h.native).toHaveBeenCalledOnce();
  expect(h.requests).toHaveLength(1);
  h.clock.advance(500);
  expect(await promise).toMatchObject({ status: "failed", error: { code: "popup_closed" } });
  await h.created();
  expect(h.requests[0]!.flow.polls).toBe(0);
  h.live();
  h.actions.signIn();
  expect(h.native).toHaveBeenCalledTimes(2);
  expect(h.requests).toHaveLength(2);
});

test("focus reopens a closed opening popup synchronously before closure and keeps its flow and result", async () => {
  const h = setup(CUSTOM);
  const first = h.live();
  const promise = h.actions.signIn();
  await h.created();
  first.closed = true;
  const dispatch = vi.spyOn(h.controller, "dispatch");
  const next = h.live();
  const atOpen: { events: number; status: string }[] = [];
  h.native.mockImplementationOnce(() => {
    atOpen.push({ events: dispatch.mock.calls.length, status: h.controller.getState().status });
    return h.results.shift();
  });
  const states: string[] = [];
  h.controller.subscribe((state) => states.push(state.status));
  h.actions.focus();
  expect(atOpen).toEqual([{ events: 0, status: "opening" }]);
  expect(h.native).toHaveBeenCalledTimes(2);
  expect(h.native.mock.calls[1]![0]).toBe(
    CUSTOM.origin + "/authorize#d=" + encodeURIComponent(h.requests[0]!.flow.url),
  );
  expect(h.native.mock.calls[1]![1]).toBe("pubky-passport-attempt-1-r1");
  expect(dispatch.mock.calls.map(([event]) => event.type)).toEqual(["POPUP_CLOSED", "REOPEN"]);
  expect(states).toEqual(["detached", "opening"]);
  expect(h.controller.snapshot().popup).toBe(next.window);
  expect(h.controller.snapshot().generation).toBe(1);
  expect(h.controller.reservedResult()).toBe(promise);
  expect(h.requests).toHaveLength(1);
  expect(h.requests[0]!.flow.polls).toBe(1);
  expect(next.closed).toBe(false);
});

test.each(["null", "undefined-null", "undefined-undefined", "closed", "undefined-closed"] as const)(
  "closed opening retry %s dispatches no model event",
  async (kind) => {
    const h = setup();
    const first = h.live();
    const promise = h.actions.signIn();
    await h.created();
    first.closed = true;
    const closed = new FakePopupWindow();
    closed.closed = true;
    const outcomes = {
      null: [null],
      "undefined-null": [undefined, null],
      "undefined-undefined": [undefined, undefined],
      closed: [closed.window],
      "undefined-closed": [undefined, closed.window],
    };
    h.results.push(...outcomes[kind]);
    const before = h.controller.snapshot();
    const dispatch = vi.spyOn(h.controller, "dispatch");
    h.actions.focus();
    expect(h.native).toHaveBeenCalledTimes(1 + outcomes[kind].length);
    expect(dispatch).not.toHaveBeenCalled();
    expect(h.controller.snapshot()).toBe(before);
    expect(h.controller.reservedResult()).toBe(promise);
    expect(h.redirect).not.toHaveBeenCalled();
    closed.assertHealthy();
  },
);

test("the blank retry obtains its replacement before emitting the opening closure", async () => {
  const h = setup();
  const first = h.live();
  const promise = h.actions.signIn();
  await h.created();
  first.closed = true;
  h.results.push(undefined);
  const next = h.live();
  const dispatch = vi.spyOn(h.controller, "dispatch");
  const eventsAtOpen: number[] = [];
  for (let i = 0; i < 2; i++)
    h.native.mockImplementationOnce(() => {
      eventsAtOpen.push(dispatch.mock.calls.length);
      return h.results.shift();
    });
  h.actions.focus();
  expect(eventsAtOpen).toEqual([0, 0]);
  expect(h.native).toHaveBeenCalledTimes(3);
  expect(h.native.mock.calls[1]![0]).toBe(h.native.mock.calls[2]![0]);
  expect(h.native.mock.calls[1]![2]).toBe(h.native.mock.calls[2]![2]);
  expect(h.native.mock.calls[2]![1]).toBe("_blank");
  expect(h.controller.snapshot().popup).toBe(next.window);
  expect(h.controller.reservedResult()).toBe(promise);
});

test.each(["cancel", "dispose"] as const)(
  "%s in the closure observer prevents replacement adoption",
  async (method) => {
    const h = setup();
    const first = h.live();
    const promise = h.actions.signIn();
    await h.created();
    first.closed = true;
    const next = h.live();
    h.controller.subscribe((state) => {
      if (state.status === "detached") h.controller[method]();
    });
    h.actions.focus();
    expect(next.closed).toBe(true);
    expect(h.controller.snapshot().popup).toBeUndefined();
    expect(await promise).toMatchObject({ status: "failed", error: { code: "cancelled" } });
    expect(h.requests).toHaveLength(1);
  },
);

test("Session delivery during closure cannot replace the next attempt's window", async () => {
  const h = setup();
  const first = h.live();
  const promise = h.actions.signIn();
  await h.created();
  first.closed = true;
  const unused = h.live();
  const successor = h.live();
  const winner = h.session();
  let next: ReturnType<typeof h.actions.signIn> | undefined;
  h.controller.subscribe((state) => {
    if (state.status === "detached")
      h.controller.receiveSession(1, winner.session, {
        publicKey: "approved-key",
        capabilities: [],
        capabilitiesMatch: true,
      });
  });
  h.controller.onSession(() => {
    next = h.actions.signIn();
  });
  h.actions.focus();
  expect(unused.closed).toBe(true);
  expect(successor.closed).toBe(false);
  expect(await promise).toMatchObject({ status: "signed-in", session: winner.session });
  expect(h.controller.snapshot().popup).toBe(successor.window);
  expect(h.controller.getState()).toMatchObject({ status: "opening", attemptId: "attempt-2" });
  expect(h.controller.reservedResult()).toBe(next);
  expect(h.received).toHaveBeenCalledOnce();
});

test("an opening popup with a created flow keeps its live window on repeated clicks", async () => {
  const h = setup(CUSTOM);
  const first = h.live();
  const promise = h.actions.signIn();
  await h.created();
  const before = h.controller.snapshot();
  const focusCount = first.focusCalls;
  h.actions.focus();
  expect(h.actions.signIn()).toBe(promise);
  expect(first.focusCalls).toBe(focusCount + 2);
  expect(h.native).toHaveBeenCalledOnce();
  expect(h.controller.snapshot()).toBe(before);
  expect(h.requests).toHaveLength(1);
});

test("a native throw while replacing an opening popup leaves the existing attempt pending", async () => {
  const h = setup();
  const first = h.live();
  const promise = h.actions.signIn();
  await h.created();
  first.closed = true;
  const before = h.controller.snapshot();
  const dispatch = vi.spyOn(h.controller, "dispatch");
  h.native.mockImplementationOnce(() => {
    throw new Error(["private", "native", "text"].join("-"));
  });
  expect(() => h.actions.focus()).not.toThrow();
  expect(dispatch).not.toHaveBeenCalled();
  expect(h.controller.snapshot()).toBe(before);
  expect(h.controller.reservedResult()).toBe(promise);
  expect(h.requests).toHaveLength(1);
});

test("reentrant focus during the closure transition waits for replacement ownership", async () => {
  const h = setup();
  const first = h.live();
  const promise = h.actions.signIn();
  await h.created();
  first.closed = true;
  const replacement = h.live();
  const states: string[] = [];
  const repeated: ReturnType<typeof h.actions.signIn>[] = [];
  const unsubscribe = h.controller.subscribe((state) => {
    states.push(state.status);
    h.actions.focus();
    repeated.push(h.actions.signIn());
  });
  h.actions.focus();
  unsubscribe();
  expect(states).toEqual(["detached", "opening"]);
  expect(repeated).toEqual([promise, promise]);
  expect(h.controller.snapshot().popup).toBe(replacement.window);
  expect(h.native).toHaveBeenCalledTimes(2);
  expect(h.requests).toHaveLength(1);
  expect(replacement.closed).toBe(false);
});

test("a replacement requested inside a state observer holds its reservation through queued adoption", async () => {
  const h = setup();
  const first = h.live();
  const promise = h.actions.signIn();
  const replacement = h.live();
  let requested = false;
  const repeated: ReturnType<typeof h.actions.signIn>[] = [];
  const stopFirst = h.controller.subscribe((state) => {
    if (state.status === "opening" && state.ringLink && !requested) {
      requested = true;
      first.closed = true;
      h.actions.focus();
    }
  });
  const stopSecond = h.controller.subscribe(() => {
    h.actions.focus();
    repeated.push(h.actions.signIn());
  });
  await h.created();
  stopFirst();
  stopSecond();
  expect(requested).toBe(true);
  expect(repeated).toHaveLength(3);
  for (const current of repeated) expect(current).toBe(promise);
  expect(h.native).toHaveBeenCalledTimes(2);
  expect(h.controller.snapshot().popup).toBe(replacement.window);
  expect(replacement.closed).toBe(false);
  expect(h.requests).toHaveLength(1);
});

test("a queued cancellation inside native open cannot adopt the next prepared flow", async () => {
  const h = setup();
  h.context.leases = 1;
  const opened = h.live();
  let requested = false;
  let result: ReturnType<typeof h.actions.signIn> | undefined;
  h.native.mockImplementationOnce(() => {
    h.controller.cancel();
    return h.results.shift();
  });
  const unsubscribe = h.controller.subscribe((state) => {
    if (state.status === "preparing" && !requested) {
      requested = true;
      result = h.actions.signIn();
    }
  });
  h.controller.dispatch({ type: "PREPARE" });
  unsubscribe();
  expect(await result).toMatchObject({ status: "failed", error: { code: "cancelled" } });
  expect(h.controller.getState().status).toBe("preparing");
  expect(h.controller.snapshot().popup).toBeUndefined();
  expect(opened.closed).toBe(true);
  expect(h.native).toHaveBeenCalledOnce();
  expect(h.requests).toHaveLength(2);
});
