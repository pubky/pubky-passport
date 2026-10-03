import { AttemptController } from "/modules/attempt/AttemptController.js";
import { AttemptEffects } from "/modules/attempt/AttemptEffects.js";
import { FlowRegistry } from "/modules/flow/FlowRegistry.js";
import { BrowserPopup } from "/modules/popup/BrowserPopup.js";
import { resolveClientOptions } from "/modules/config/resolveClientOptions.js";
import { PassportError } from "/modules/errors/PassportError.js";

// Only the controller's deadlines use this clock; native popup and message tasks stay real.
let now = 0;
let nextTimer = 0;
const timers = new Map();
const clock = {
  now: () => now,
  schedule(callback, ms) {
    const id = ++nextTimer;
    timers.set(id, { at: now + ms, callback });
    return () => timers.delete(id);
  },
};
const timeouts = resolveClientOptions({}, (value) => value).timeouts;
const attemptId = "passport-status-attempt-01";
const popup = new BrowserPopup();
let controller;
let settlePoll;
let authorizationUrl;
let instance;
let delivered;
const harness = {
  events: [],
  deliveries: 0,
  flowFrees: 0,
  sessionFrees: 0,
  signouts: 0,
  result: undefined,
  timeouts,
  configure(origin, url) {
    authorizationUrl = url;
    instance = { origin, host: new URL(origin).host, isCustom: false };
  },
  state: () => controller.getState(),
  advance(ms) {
    const end = now + ms;
    for (let count = 0; count < 1000; count++) {
      const due = [...timers]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) {
        now = end;
        return;
      }
      const [id, timer] = due;
      timers.delete(id);
      now = timer.at;
      timer.callback();
    }
    throw new Error("Unbounded fixture timer loop");
  },
  approve() {
    // A controlled SDK boundary with known metadata, never a successful real approval claim.
    if (!settlePoll) throw new Error("No pending flow poll");
    const settle = settlePoll;
    settlePoll = undefined;
    settle({
      signout: async () => {
        harness.signouts++;
      },
      free: () => {
        harness.sessionFrees++;
      },
    });
  },
  dispose() {
    controller.dispose();
    if (settlePoll) {
      settlePoll();
      settlePoll = undefined;
    }
    delivered?.free();
    delivered = undefined;
  },
};
const flows = new FlowRegistry(
  () => ({
    start: async () => ({
      ok: true,
      value: {
        authorizationUrl,
        tryPollOnce: () =>
          new Promise((resolve) => {
            settlePoll = resolve;
          }),
        free: () => {
          harness.flowFrees++;
        },
        saveDelegated() {
          throw new Error("Popup flows must not save");
        },
      },
    }),
    resume() {
      throw new Error("Popup flows must not resume");
    },
  }),
  {
    event: (event) => controller.dispatch(event),
    session: (id, session) =>
      controller.receiveSession(id, session, {
        publicKey: "fixture-approved-key",
        capabilities: [],
        capabilitiesMatch: true,
      }),
  },
);
document.querySelector("#open").addEventListener("click", () => {
  const window = popup.open({ instance, attemptId, generation: 0 });
  if (!window) throw new Error("Fixture popup was blocked");
  const effects = new AttemptEffects({
    flows,
    popup,
    profile: "optional",
    // No profile: an optional-profile sign-in finishes without one.
    readProfile: async () => ({ kind: "missing" }),
    event(event) {
      harness.events.push(event);
      controller.dispatch(event);
    },
    failed: (cause) =>
      controller.dispatch({
        type: "RUNTIME_FAILED",
        error: new PassportError("internal", { cause }),
      }),
    redirect(command) {
      if (command.type !== "DeleteRedirectState") throw new Error("Unexpected redirect command");
    },
    returnCallbacks() {
      throw new Error("Popup flows carry no callbacks");
    },
  });
  controller = new AttemptController(
    instance,
    () => ({
      now,
      defaultInstance: instance,
      attemptId,
      visible: true,
      leases: 0,
      timeouts,
      profile: "optional",
    }),
    effects,
    undefined,
    clock,
  );
  controller.onSession((session) => {
    harness.deliveries++;
    delivered = session;
  });
  // What the client does in the click: reserve the result, then start the attempt.
  const result = controller.reserveResult();
  controller.dispatch({ type: "SIGN_IN", instance, popup: window });
  void result.then((settled) => {
    harness.result = settled.status;
  });
});
window.__attemptStatus = harness;
