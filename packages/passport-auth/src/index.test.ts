// @vitest-environment jsdom
import { Pubky, type GrantAuthFlowOptions } from "@synonymdev/pubky";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPassportAuth,
  POLL_INTERVAL_MS,
  MAX_POLL_RETRIES,
  POPUP_CHECK_INTERVAL_MS,
  SUCCESS_GRACE_MS,
  type PassportAuth,
  type PassportAuthOptions,
  type PassportPubky,
  type PassportSignInResult,
} from "./index";
import {
  AUTHORIZATION_URL,
  FakeFlow,
  FakePopup,
  FakePubky,
  fakeSession,
  INSTANCE,
  outcomeMessage,
  PAGE_ORIGIN,
  postFrom,
  returnMessage,
  SECRET,
  useHttpsPage,
} from "./testing/fakes";

const TIMEOUT_MS = 60_000;

let pubky: FakePubky;
let popup: FakePopup;
let open: ReturnType<typeof vi.spyOn>;
let passport: PassportAuth;

function create(options: Partial<PassportAuthOptions> = {}): PassportAuth {
  passport = createPassportAuth({
    pubky,
    capabilities: "/pub/example.app/:rw",
    clientId: "example.app",
    appName: "Example App",
    instance: INSTANCE,
    callbackUrl: "/passport/return",
    timeoutMs: TIMEOUT_MS,
    ...options,
  });
  return passport;
}

/** Lets promise callbacks run without moving the clock. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** Starts an attempt and resolves its flow, so polling has begun. */
async function started(
  options: Partial<PassportAuthOptions> = {},
): Promise<{ result: Promise<PassportSignInResult>; flow: FakeFlow }> {
  create(options);
  const result = passport.signIn();
  const flow = new FakeFlow();
  pubky.starts[0]!.resolve(flow);
  await flush();
  return { result, flow };
}

function startOptions(index = -1): GrantAuthFlowOptions {
  return (pubky.startGrantAuthFlow.mock.calls.at(index) as unknown[])[2] as GrantAuthFlowOptions;
}

/** The current attempt's id, as carried in its callback URLs. */
function attemptId(): string {
  const success = startOptions().xCallback?.xSuccess;
  return new URL(String(success)).searchParams.get("passport-attempt") ?? "";
}

async function settledWithin(result: Promise<PassportSignInResult>): Promise<boolean> {
  let settled = false;
  void result.then(() => {
    settled = true;
  });
  await flush();
  return settled;
}

beforeEach(() => {
  useHttpsPage();
  vi.useFakeTimers();
  pubky = new FakePubky();
  popup = new FakePopup();
  open = vi.spyOn(window, "open").mockImplementation(() => popup.asWindow());
});

afterEach(() => {
  passport?.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("opening the popup", () => {
  it("opens about:blank with a unique name and popup features before any await", () => {
    create();
    void passport.signIn();

    expect(open).toHaveBeenCalledTimes(1);
    const [url, name, features] = open.mock.calls[0]!;
    expect(url).toBe("about:blank");
    expect(name).toMatch(/^pubky-passport-[0-9a-f-]{36}$/u);
    expect(features).toBe("popup");
    // The SDK call starts in the same task, after the window exists.
    expect(pubky.startGrantAuthFlow).toHaveBeenCalledTimes(1);
    expect(passport.state).toBe("pending");
  });

  it("uses a new window name for every attempt", async () => {
    const { result } = await started();
    passport.cancel();
    await result;
    popup = new FakePopup();
    void passport.signIn();

    const names = open.mock.calls.map((call: unknown[]) => call[1]);
    expect(new Set(names).size).toBe(2);
  });

  it.each([
    ["returns null", () => null],
    ["returns a closed window", () => Object.assign(new FakePopup(), { closed: true }).asWindow()],
    [
      "throws",
      () => {
        throw new Error("blocked");
      },
    ],
  ])("reports popup-blocked at once when window.open %s, starting nothing", async (_, impl) => {
    open.mockImplementation(impl);
    const addListener = vi.spyOn(window, "addEventListener");
    create();

    const result = await passport.signIn();

    expect(result).toEqual({ ok: false, reason: "popup-blocked" });
    expect(pubky.startGrantAuthFlow).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(passport.state).toBe("idle");
  });

  it("returns the same promise and focuses the open popup while an attempt is pending", () => {
    create();
    const first = passport.signIn();
    const second = passport.signIn();

    expect(second).toBe(first);
    expect(open).toHaveBeenCalledTimes(1);
    expect(pubky.startGrantAuthFlow).toHaveBeenCalledTimes(1);
    expect(popup.focus).toHaveBeenCalledTimes(1);
  });
});

describe("starting the flow", () => {
  it("navigates the popup once to /authorize with the URL encoded once and never logs it", async () => {
    const consoleCalls = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    await started();

    expect(popup.location.replace).toHaveBeenCalledTimes(1);
    expect(popup.location.replace).toHaveBeenCalledWith(
      `${INSTANCE}/authorize#d=${encodeURIComponent(AUTHORIZATION_URL)}`,
    );
    for (const spy of consoleCalls) expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(open.mock.calls)).not.toContain(SECRET);
  });

  it("puts the attempt id in same-origin callback URLs and sends the app name", () => {
    create();
    void passport.signIn();
    const id = attemptId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);
    // Pages loaded in the popup can read window.name; it must not reveal the attempt id.
    expect(String(open.mock.calls[0]?.[1])).not.toContain(id);

    expect(pubky.startGrantAuthFlow).toHaveBeenCalledWith(
      "/pub/example.app/:rw",
      expect.anything(),
      {
        clientId: "example.app",
        xCallback: {
          xSource: "Example App",
          xSuccess: `${PAGE_ORIGIN}/passport/return?passport-attempt=${id}&passport-outcome=success`,
          xError: `${PAGE_ORIGIN}/passport/return?passport-attempt=${id}&passport-outcome=error`,
          xCancel: `${PAGE_ORIGIN}/passport/return?passport-attempt=${id}&passport-outcome=cancel`,
        },
      },
    );
  });

  it("sends no callback URLs without callbackUrl", () => {
    create({ callbackUrl: undefined });
    void passport.signIn();

    const options = startOptions();
    expect(options).toEqual({ clientId: "example.app", xCallback: { xSource: "Example App" } });
  });

  it("asks for a signed approval when any capability has an e action", () => {
    create({ capabilities: "/pub/example.app/:rw,/priv/example.app/:e" });
    void passport.signIn();

    expect(startOptions()).toMatchObject({
      approvalFormat: "signedApprovalV1",
    });
  });

  it("frees a flow that arrives after the attempt ended and never navigates", async () => {
    create();
    const result = passport.signIn();
    passport.cancel();
    expect(await result).toEqual({ ok: false, reason: "aborted" });

    const flow = new FakeFlow();
    pubky.starts[0]!.resolve(flow);
    await flush();

    expect(flow.free).toHaveBeenCalledTimes(1);
    expect(flow.tryPollOnce).not.toHaveBeenCalled();
    expect(popup.location.replace).not.toHaveBeenCalled();
  });

  it("ends with failed when the popup can no longer be navigated", async () => {
    popup.location.replace.mockImplementation(() => {
      throw new Error("cross-origin");
    });
    const { result, flow } = await started();

    expect(await result).toMatchObject({ ok: false, reason: "failed" });
    expect(flow.free).toHaveBeenCalledTimes(1);
  });
});

describe("outcome messages from Passport", () => {
  it("acknowledges a valid outcome to the exact instance origin", async () => {
    const { result } = await started();

    postFrom(popup, INSTANCE, outcomeMessage("cancel", "abc"));

    expect(popup.postMessage).toHaveBeenCalledWith(
      { type: "pubky-passport.authorization-outcome-ack", version: 1, messageId: "abc" },
      INSTANCE,
    );
    expect(await result).toEqual({ ok: false, reason: "cancelled" });
  });

  it("maps an error outcome to rejected", async () => {
    const { result } = await started();
    postFrom(popup, INSTANCE, outcomeMessage("error"));
    expect(await result).toEqual({ ok: false, reason: "rejected" });
  });

  it.each([
    ["another origin", { origin: "https://evil.example" }],
    ["the page origin", { origin: PAGE_ORIGIN }],
    ["a null origin", { origin: "null" }],
    ["the instance origin over http", { origin: "http://passport.example" }],
    ["another window", { source: "other" }],
    ["the opener itself", { source: "self" }],
    ["a wrong type", { data: { ...outcomeMessage("cancel"), type: "pubky-passport.other" } }],
    ["version 2", { data: { ...outcomeMessage("cancel"), version: 2 } }],
    ["a string version", { data: { ...outcomeMessage("cancel"), version: "1" } }],
    ["an unknown outcome", { data: outcomeMessage("cancelled") }],
    ["a numeric messageId", { data: { ...outcomeMessage("cancel"), messageId: 1 } }],
    ["an empty messageId", { data: outcomeMessage("cancel", "") }],
    ["a huge messageId", { data: outcomeMessage("cancel", "x".repeat(129)) }],
    ["no messageId", { data: { type: "pubky-passport.authorization-outcome", version: 1 } }],
    ["an extra field", { data: { ...outcomeMessage("cancel"), callback: "https://x" } }],
    ["an array", { data: [outcomeMessage("cancel")] }],
    ["a string", { data: JSON.stringify(outcomeMessage("cancel")) }],
    ["null", { data: null }],
  ])("ignores a message from %s", async (_, variant) => {
    const { result } = await started();
    const other = new FakePopup();
    const source =
      "source" in variant ? (variant.source === "self" ? window : other) : (popup as unknown);
    const origin = "origin" in variant ? variant.origin : INSTANCE;
    const data = "data" in variant ? variant.data : outcomeMessage("cancel");

    postFrom(source, origin, data);

    expect(popup.postMessage).not.toHaveBeenCalled();
    expect(await settledWithin(result)).toBe(false);
    expect(passport.state).toBe("pending");
  });

  it("keeps polling after success until the SDK returns a Session", async () => {
    const { result, flow } = await started();

    postFrom(popup, INSTANCE, outcomeMessage("success"));
    // Passport closes the popup itself after the acknowledgement.
    popup.closed = true;
    flow.lastPoll().resolve(undefined);
    await vi.advanceTimersByTimeAsync(POPUP_CHECK_INTERVAL_MS * 4);
    expect(await settledWithin(result)).toBe(false);
    expect(flow.tryPollOnce).toHaveBeenCalledTimes(2);

    flow.lastPoll().resolve(undefined);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    const session = fakeSession();
    flow.lastPoll().resolve(session);

    expect(await result).toEqual({ ok: true, session });
    expect(flow.free).toHaveBeenCalledTimes(1);
    expect(flow.freedWhilePending).toBe(0);
    expect(session.signout).not.toHaveBeenCalled();
  });

  it("does not end when the popup closes after success and polls come back empty", async () => {
    const { result, flow } = await started();
    postFrom(popup, INSTANCE, outcomeMessage("success"));
    popup.closed = true;
    for (let i = 0; i < 8; i += 1) {
      flow.lastPoll().resolve(undefined);
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    }
    expect(await settledWithin(result)).toBe(false);
  });

  it("ends as popup-closed when no Session follows success within the grace period", async () => {
    const { result, flow } = await started();
    postFrom(popup, INSTANCE, outcomeMessage("success"));
    popup.closed = true;
    let elapsed = 0;
    while (!(await settledWithin(result)) && elapsed < SUCCESS_GRACE_MS * 2) {
      if (flow.pending > 0) flow.lastPoll().resolve(undefined);
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      elapsed += POLL_INTERVAL_MS;
    }
    expect(await result).toEqual({ ok: false, reason: "popup-closed" });
    expect(elapsed).toBeGreaterThanOrEqual(SUCCESS_GRACE_MS);
    expect(elapsed).toBeLessThan(TIMEOUT_MS);
  });

  it("keeps waiting when success arrives while the last poll runs", async () => {
    const { result, flow } = await started();
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(POPUP_CHECK_INTERVAL_MS * 2);
    // The poll running at confirmation returns, then the last poll starts.
    flow.lastPoll().resolve(undefined);
    await flush();
    expect(flow.tryPollOnce).toHaveBeenCalledTimes(2);
    postFrom(popup, PAGE_ORIGIN, returnMessage(attemptId(), "success"));
    flow.lastPoll().resolve(undefined);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(await settledWithin(result)).toBe(false);

    const session = fakeSession();
    flow.lastPoll().resolve(session);
    expect(await result).toEqual({ ok: true, session });
  });

  it("times out after success when no Session arrives and the popup stays open", async () => {
    const { result } = await started();
    postFrom(popup, INSTANCE, outcomeMessage("success"));

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(await result).toEqual({ ok: false, reason: "timeout" });
  });
});

describe("callback page messages", () => {
  it("ends the attempt on the current attempt's cancel from the same origin", async () => {
    const { result } = await started();
    postFrom(popup, PAGE_ORIGIN, returnMessage(attemptId(), "cancel"));
    expect(await result).toEqual({ ok: false, reason: "cancelled" });
    // The callback page gets no acknowledgement.
    expect(popup.postMessage).not.toHaveBeenCalled();
  });

  it("treats a callback success like Passport's: keeps polling", async () => {
    const { result, flow } = await started();
    postFrom(popup, PAGE_ORIGIN, returnMessage(attemptId(), "success"));
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(POPUP_CHECK_INTERVAL_MS * 3);
    expect(await settledWithin(result)).toBe(false);

    const session = fakeSession();
    flow.lastPoll().resolve(session);
    expect(await result).toEqual({ ok: true, session });
  });

  it.each([
    ["a stale attempt id", { attempt: "stale" }],
    ["another origin", { origin: "https://evil.example" }],
    ["the instance origin", { origin: INSTANCE }],
    ["another window", { source: "other" }],
    ["a wrong type", { type: "pubky-passport.authorization-outcome" }],
    ["an extra field", { extra: true }],
  ])("ignores a callback message with %s", async (_, variant) => {
    const { result } = await started();
    const data: Record<string, unknown> = returnMessage(
      "attempt" in variant ? variant.attempt : attemptId(),
      "cancel",
    );
    if ("type" in variant) data.type = variant.type;
    if ("extra" in variant) data.extra = variant.extra;

    postFrom(
      "source" in variant ? new FakePopup() : popup,
      "origin" in variant ? variant.origin : PAGE_ORIGIN,
      data,
    );

    expect(await settledWithin(result)).toBe(false);
  });

  it("accepts callback messages when Passport runs on the page's own origin", async () => {
    const { result } = await started({ instance: PAGE_ORIGIN });
    postFrom(popup, PAGE_ORIGIN, returnMessage(attemptId(), "error"));
    expect(await result).toEqual({ ok: false, reason: "rejected" });
  });

  it("ignores messages from the previous attempt's popup", async () => {
    const first = await started();
    const stalePopup = popup;
    const staleId = attemptId();
    passport.cancel();
    await first.result;

    popup = new FakePopup();
    const result = passport.signIn();
    pubky.starts[1]!.resolve(new FakeFlow());
    await flush();

    postFrom(stalePopup, PAGE_ORIGIN, returnMessage(staleId, "cancel"));
    postFrom(stalePopup, INSTANCE, outcomeMessage("cancel"));
    postFrom(popup, PAGE_ORIGIN, returnMessage(staleId, "cancel"));

    expect(stalePopup.postMessage).not.toHaveBeenCalled();
    expect(await settledWithin(result)).toBe(false);
  });
});

describe("closing the popup", () => {
  it("confirms on two checks, polls once more, then reports popup-closed", async () => {
    const { result, flow } = await started();
    flow.lastPoll().resolve(undefined);
    await flush();
    popup.closed = true;

    await vi.advanceTimersByTimeAsync(POPUP_CHECK_INTERVAL_MS);
    expect(await settledWithin(result)).toBe(false);
    await vi.advanceTimersByTimeAsync(POPUP_CHECK_INTERVAL_MS);
    // Confirmed while the second poll runs: no new poll until it returns.
    expect(flow.tryPollOnce).toHaveBeenCalledTimes(2);
    flow.lastPoll().resolve(undefined);
    await flush();
    expect(flow.tryPollOnce).toHaveBeenCalledTimes(3);
    expect(await settledWithin(result)).toBe(false);

    flow.lastPoll().resolve(undefined);
    expect(await result).toEqual({ ok: false, reason: "popup-closed" });
    expect(flow.free).toHaveBeenCalledTimes(1);
    expect(flow.freedWhilePending).toBe(0);
  });

  it("returns the Session when the last poll finds the approval", async () => {
    const { result, flow } = await started();
    popup.closed = true;
    flow.lastPoll().resolve(undefined);
    await vi.advanceTimersByTimeAsync(POPUP_CHECK_INTERVAL_MS * 2);

    const session = fakeSession();
    flow.lastPoll().resolve(session);

    expect(await result).toEqual({ ok: true, session });
  });

  it("waits for a poll in flight, then still polls once more", async () => {
    const { result, flow } = await started();
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(POPUP_CHECK_INTERVAL_MS * 2);
    expect(flow.tryPollOnce).toHaveBeenCalledTimes(1);

    flow.lastPoll().resolve(undefined);
    await flush();
    expect(flow.tryPollOnce).toHaveBeenCalledTimes(2);
    expect(await settledWithin(result)).toBe(false);

    flow.lastPoll().resolve(undefined);
    expect(await result).toEqual({ ok: false, reason: "popup-closed" });
  });

  it("starts no last poll after a single closed check", async () => {
    const { result, flow } = await started();
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(POPUP_CHECK_INTERVAL_MS);
    flow.polls[0]!.resolve(undefined);
    await flush();
    // One check is not a confirmation: the next poll waits for the normal interval.
    expect(flow.tryPollOnce).toHaveBeenCalledTimes(1);
    expect(await settledWithin(result)).toBe(false);
  });

  it("does not end on a single closed check that reopens", async () => {
    const { result } = await started();
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(POPUP_CHECK_INTERVAL_MS);
    popup.closed = false;
    await vi.advanceTimersByTimeAsync(POPUP_CHECK_INTERVAL_MS);
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(POPUP_CHECK_INTERVAL_MS);
    expect(await settledWithin(result)).toBe(false);
  });

  it("lets the callback page's message win over its own closing", async () => {
    const { result } = await started();
    // The callback page posts, then closes on the next task.
    popup.closed = true;
    postFrom(popup, PAGE_ORIGIN, returnMessage(attemptId(), "cancel"));
    expect(await result).toEqual({ ok: false, reason: "cancelled" });
  });

  it("treats a popup whose closed getter throws as closed", async () => {
    const { result, flow } = await started();
    Object.defineProperty(popup, "closed", {
      get() {
        throw new Error("denied");
      },
    });
    await vi.advanceTimersByTimeAsync(POPUP_CHECK_INTERVAL_MS * 2);
    flow.lastPoll().resolve(undefined);
    await flush();
    flow.lastPoll().resolve(undefined);
    expect(await result).toEqual({ ok: false, reason: "popup-closed" });
    expect(flow.tryPollOnce).toHaveBeenCalledTimes(2);
  });

  it("ends at once when closed while the flow is still being created", async () => {
    create();
    const result = passport.signIn();
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(POPUP_CHECK_INTERVAL_MS * 2);
    expect(await result).toEqual({ ok: false, reason: "popup-closed" });

    const flow = new FakeFlow();
    pubky.starts[0]!.resolve(flow);
    await flush();
    expect(flow.free).toHaveBeenCalledTimes(1);
    expect(popup.location.replace).not.toHaveBeenCalled();
  });
});

describe("ending an attempt", () => {
  type Ender = (context: { flow: FakeFlow; controller: AbortController }) => Promise<void> | void;
  const enders: [string, string, Ender][] = [
    ["a cancel outcome", "cancelled", () => postFrom(popup, INSTANCE, outcomeMessage("cancel"))],
    ["an error outcome", "rejected", () => postFrom(popup, INSTANCE, outcomeMessage("error"))],
    ["the deadline", "timeout", () => vi.advanceTimersByTimeAsync(TIMEOUT_MS)],
    ["the AbortSignal", "aborted", ({ controller }) => controller.abort()],
    ["cancel()", "aborted", () => passport.cancel()],
    ["dispose()", "aborted", () => passport.dispose()],
    ["an SDK throw", "failed", ({ flow }) => flow.lastPoll().reject(new Error("relay down"))],
  ];

  it.each(enders)(
    "%s frees the flow once, after the SDK call, removes the listener and closes the popup",
    async (_, reason, endWith) => {
      create();
      const removeListener = vi.spyOn(window, "removeEventListener");
      const controller = new AbortController();
      const result = passport.signIn({ signal: controller.signal });
      const flow = new FakeFlow();
      pubky.starts[0]!.resolve(flow);
      await flush();
      expect(flow.pending).toBe(1);

      await endWith({ flow, controller });
      const ended = await result;

      expect(ended).toMatchObject({ ok: false, reason });
      expect(popup.close).toHaveBeenCalledTimes(1);
      expect(removeListener).toHaveBeenCalledWith("message", expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
      expect(passport.state).toBe("idle");
      // Freed now if no poll is in flight, otherwise when that poll returns.
      if (flow.pending > 0) {
        expect(flow.free).not.toHaveBeenCalled();
        flow.lastPoll().resolve(undefined);
        await flush();
      }
      expect(flow.free).toHaveBeenCalledTimes(1);
      expect(flow.freedWhilePending).toBe(0);
      expect(flow.tryPollOnce).toHaveBeenCalledTimes(1);

      // Nothing reacts any more.
      postFrom(popup, INSTANCE, outcomeMessage("cancel"));
      expect(popup.postMessage).toHaveBeenCalledTimes(
        reason === "cancelled" || reason === "rejected" ? 1 : 0,
      );
    },
  );

  it("frees the flow at once and clears the poll timer when ended between polls", async () => {
    const { result, flow } = await started();
    flow.lastPoll().resolve(undefined);
    await flush();
    expect(flow.pending).toBe(0);

    passport.cancel();

    expect(await result).toEqual({ ok: false, reason: "aborted" });
    expect(flow.free).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
    expect(flow.tryPollOnce).toHaveBeenCalledTimes(1);
  });

  const transient = (reason: string, statusCode?: number) =>
    Object.assign(new Error("request failed"), {
      name: "RequestError",
      data: { reason, ...(statusCode === undefined ? {} : { statusCode }) },
    });

  it.each([
    ["a connection error", transient("Connection")],
    ["a timeout", transient("Timeout")],
    ["a relay 503", transient("Http", 503)],
    ["a relay 429", transient("Http", 429)],
  ])("retries a poll after %s and keeps the popup open", async (_, error) => {
    const { result, flow } = await started();
    flow.lastPoll().reject(error);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);

    expect(flow.tryPollOnce).toHaveBeenCalledTimes(2);
    expect(popup.close).not.toHaveBeenCalled();
    const session = fakeSession();
    flow.lastPoll().resolve(session);
    expect(await result).toEqual({ ok: true, session });
  });

  it("ends as failed after too many transient poll failures in a row", async () => {
    const { result, flow } = await started();
    const error = transient("Connection");
    for (let failure = 0; failure <= MAX_POLL_RETRIES; failure += 1) {
      flow.lastPoll().reject(error);
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2 ** (failure + 2));
    }
    expect(await result).toEqual({ ok: false, reason: "failed", error });
    expect(flow.tryPollOnce).toHaveBeenCalledTimes(MAX_POLL_RETRIES + 1);
    expect(flow.free).toHaveBeenCalledTimes(1);
  });

  it("counts only failures in a row", async () => {
    const { result, flow } = await started();
    for (let round = 0; round < MAX_POLL_RETRIES * 2; round += 1) {
      flow.lastPoll().reject(transient("Connection"));
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
      flow.lastPoll().resolve(undefined);
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    }
    expect(await settledWithin(result)).toBe(false);
  });

  it.each([
    ["an authentication error", { name: "AuthenticationError" }],
    ["a relay 400", { name: "RequestError", data: { reason: "Http", statusCode: 400 } }],
    ["a decode error", { name: "RequestError", data: { reason: "Decode" } }],
  ])("ends at once on %s", async (_, shape) => {
    const { result, flow } = await started();
    const error = Object.assign(new Error("permanent"), shape);
    flow.lastPoll().reject(error);
    expect(await result).toEqual({ ok: false, reason: "failed", error });
  });

  it("passes the abort reason as error", async () => {
    create();
    const controller = new AbortController();
    const result = passport.signIn({ signal: controller.signal });
    const reason = new Error("navigated away");
    controller.abort(reason);
    expect(await result).toEqual({ ok: false, reason: "aborted", error: reason });
  });

  it("does not open a popup for an already aborted signal", async () => {
    create();
    const controller = new AbortController();
    controller.abort();
    const result = await passport.signIn({ signal: controller.signal });
    expect(result).toMatchObject({ ok: false, reason: "aborted" });
    expect(open).not.toHaveBeenCalled();
  });

  it("signs out a Session that arrives after the attempt ended", async () => {
    const { result, flow } = await started();
    passport.cancel();
    await result;

    const session = fakeSession();
    flow.lastPoll().resolve(session);
    await flush();

    expect(session.signout).toHaveBeenCalledTimes(1);
    expect(session.free).toHaveBeenCalledTimes(1);
    expect(flow.free).toHaveBeenCalledTimes(1);
  });

  it("reports SDK failures with their error", async () => {
    create();
    const result = passport.signIn();
    const error = new Error("relay unreachable");
    pubky.starts[0]!.reject(error);
    expect(await result).toEqual({ ok: false, reason: "failed", error });
    expect(popup.close).toHaveBeenCalled();
  });

  it("reports a synchronous SDK throw as failed", async () => {
    pubky.startGrantAuthFlow.mockImplementation(() => {
      throw new Error("bad input");
    });
    create();
    expect(await passport.signIn()).toMatchObject({ ok: false, reason: "failed" });
  });

  it("reports a synchronous tryPollOnce throw as failed and frees the flow", async () => {
    create();
    const result = passport.signIn();
    const flow = new FakeFlow();
    flow.tryPollOnce.mockImplementation(() => {
      throw new Error("closure invoked recursively");
    });
    pubky.starts[0]!.resolve(flow);
    expect(await result).toMatchObject({ ok: false, reason: "failed" });
    expect(flow.free).toHaveBeenCalledTimes(1);
  });

  it("refuses new attempts after dispose without opening a popup", async () => {
    create();
    passport.dispose();
    expect(await passport.signIn()).toEqual({ ok: false, reason: "aborted" });
    expect(open).not.toHaveBeenCalled();
  });

  it("can start a fresh attempt after one ended", async () => {
    const first = await started();
    postFrom(popup, INSTANCE, outcomeMessage("cancel"));
    await first.result;

    popup = new FakePopup();
    const second = passport.signIn();
    expect(second).not.toBe(first.result);
    expect(pubky.startGrantAuthFlow).toHaveBeenCalledTimes(2);
  });
});

describe("state", () => {
  it("notifies subscribers of pending and idle and stops after unsubscribe", async () => {
    create();
    const states: string[] = [];
    const unsubscribe = passport.subscribe((state) => states.push(state));

    const result = passport.signIn();
    expect(passport.state).toBe("pending");
    passport.cancel();
    await result;
    expect(states).toEqual(["pending", "idle"]);

    unsubscribe();
    void passport.signIn();
    expect(states).toEqual(["pending", "idle"]);
  });

  it("gives later subscribers the live state when an earlier one starts a new attempt", async () => {
    create();
    const first = passport.signIn();
    let restarted = false;
    passport.subscribe((state) => {
      if (state === "idle" && !restarted) {
        restarted = true;
        popup = new FakePopup();
        void passport.signIn();
      }
    });
    const seen: string[] = [];
    passport.subscribe((state) => seen.push(state));

    passport.cancel();
    await first;

    expect(passport.state).toBe("pending");
    expect(seen.at(-1)).toBe("pending");
  });

  it("does not start the SDK flow when a subscriber ends the attempt at once", async () => {
    create();
    passport.subscribe((state) => {
      if (state === "pending") passport.cancel();
    });
    expect(await passport.signIn()).toEqual({ ok: false, reason: "aborted" });
    expect(pubky.startGrantAuthFlow).not.toHaveBeenCalled();
  });

  it("keeps ending the attempt when a subscriber throws, and reports the error", async () => {
    const reported: unknown[] = [];
    vi.spyOn(globalThis, "queueMicrotask").mockImplementation((task) => {
      try {
        task();
      } catch (error) {
        reported.push(error);
      }
    });
    create();
    passport.subscribe(() => {
      throw new Error("subscriber bug");
    });
    const result = passport.signIn();
    passport.cancel();

    expect(await result).toEqual({ ok: false, reason: "aborted" });
    expect(popup.close).toHaveBeenCalled();
    expect(reported).toHaveLength(2);
  });
});

describe("SDK compatibility", () => {
  it("accepts the real Pubky class as the pubky option", () => {
    const real: PassportPubky = Pubky.prototype;
    expect(typeof real.startGrantAuthFlow).toBe("function");
  });
});
