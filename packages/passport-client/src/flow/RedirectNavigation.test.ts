import { afterEach, expect, test, vi } from "vitest";
import { FakeClock } from "../../test/FakeClock.js";
import { FakeFlowPort } from "../../test/FakeFlowPort.js";
import { AttemptController } from "../attempt/AttemptController.js";
import type { AttemptCommand } from "../attempt/AttemptEffectPort.js";
import { resolveClientOptions } from "../config/resolveClientOptions.js";
import { FlowRegistry } from "./FlowRegistry.js";
import { RedirectNavigation } from "./RedirectNavigation.js";
import { returnCallbacks } from "./returnCallbacks.js";
import { RedirectStateStore } from "./RedirectStateStore.js";
import { startAttempt } from "../../test/startAttempt.js";

const DEFAULT = {
  origin: "https://default.example",
  host: "default.example",
  isCustom: false,
};
const INSTANCE = {
  origin: "https://custom.example",
  host: "custom.example",
  isCustom: true,
};
const APP = "https://app.example:8443";
const PRIVATE = ["navigation", "private", "canary"].join("-");
const KEY = "pubky-passport:redirect:v1";
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

function setup(autoNavigate = true, profile: "required" | "optional" = "optional") {
  const clock = new FakeClock();
  const order: string[] = [];
  const data = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => {
      order.push("read");
      return data.get(key) ?? null;
    }),
    setItem: vi.fn((key: string, value: string) => {
      order.push("write");
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      order.push("delete");
      data.delete(key);
    }),
  };
  const context = {
    defaultInstance: DEFAULT,
    attemptId: "A".repeat(22),
    now: 0,
    leases: 0,
    visible: true,
    profile: "optional" as const,
    timeouts: resolveClientOptions({}, (v) => v).timeouts,
    messages: { "error.internal": "Safe native failure" },
  };
  const store = new RedirectStateStore({
    storage: () => storage,
    client: JSON.stringify(["Example", "", "app.example", DEFAULT.origin, "optional"]),
    defaultOrigin: DEFAULT.origin,
    clock,
  });
  const handle = new FakeFlowPort("pubkyauth://" + PRIVATE);
  const save = handle.saveDelegated.bind(handle);
  vi.spyOn(handle, "saveDelegated").mockImplementation(() => {
    order.push("delegate");
    return save();
  });
  const flows = new FlowRegistry(
    () => ({
      start: async () => ({ ok: true, value: handle }),
      resume: async () => {
        throw new Error("Unexpected resume");
      },
    }),
    {
      event: (event) => controller.dispatch(event),
      session: () => {
        throw new Error("Unexpected Session");
      },
    },
    clock,
  );
  const commands: AttemptCommand[] = [];
  const diagnostic = vi.fn();
  const controller = new AttemptController(
    INSTANCE,
    () => ({ ...context, now: clock.now() }),
    {
      run(command) {
        commands.push(command);
        if (command.type === "CreateFlow")
          flows.create(
            command.flowId,
            command.instance,
            command.returnTo === undefined
              ? undefined
              : returnCallbacks(`${APP}/return`, command.returnTo),
          );
        else if (command.type === "SaveStateAndNavigate" && autoNavigate)
          navigation.navigate(command.flowId);
        else if (command.type === "FreeFlow") flows.free(command.flowId);
        else if (command.type === "StartPolling") flows.start(command.flowId);
        else if (command.type === "EndAttempt" || command.type === "DeleteRedirectState")
          store.deleteOwned();
      },
      dispose() {
        store.deleteOwned();
        flows.dispose();
      },
    },
    diagnostic,
    clock,
  );
  const opener = { value: {} as unknown };
  const set = vi.fn((value: unknown) => {
    order.push("sever");
    opener.value = value;
  });
  const get = vi.fn(() => {
    order.push("verify");
    return opener.value;
  });
  const assign = vi.fn<(url: string) => void>(() => {
    order.push("assign");
  });
  const page = {
    get opener() {
      return get();
    },
    set opener(value: unknown) {
      set(value);
    },
    location: { assign },
  };
  const options = {
    controller,
    flows,
    store,
    page: () => page,
    profile,
    errors: { messages: context.messages, context: { defaultHost: DEFAULT.host } },
  };
  const navigation = new RedirectNavigation(options);
  const settle = controller.completeRedirect.bind(controller);
  vi.spyOn(controller, "completeRedirect").mockImplementation((model) => {
    order.push("settle");
    settle(model);
  });
  const h = {
    clock,
    order,
    data,
    storage,
    context,
    store,
    handle,
    flows,
    controller,
    navigation,
    commands,
    diagnostic,
    opener,
    set,
    get,
    assign,
    page,
    options,
    signIn(cause: "blocked" | "preferred" = "preferred") {
      return startAttempt(controller, {
        type: "SIGN_IN",
        instance: INSTANCE,
        route: { kind: "redirect", cause },
      });
    },
  };
  cleanups.push(async () => {
    controller.dispose();
    if (handle.pending) handle.settle();
    await flush();
    if (handle.reads || handle.frees) handle.assertFreed();
    clock.assertEmpty();
  });
  return h;
}

test("a required profile travels next to the request, for Passport to check before the review", async () => {
  const h = setup(true, "required");
  const result = h.signIn();
  await flush();
  expect(await result).toEqual({ status: "redirecting" });
  expect(h.assign).toHaveBeenCalledExactlyOnceWith(
    INSTANCE.origin + "/authorize#d=" + encodeURIComponent(h.handle.url) + "&profile=required",
  );
});

test("saves, verifies severance and assigns before settling, without polling or freeing the flow", async () => {
  const h = setup();
  const result = h.signIn();
  await flush();
  expect(await result).toEqual({ status: "redirecting" });
  expect(h.order).toEqual(["delegate", "write", "read", "sever", "verify", "assign", "settle"]);
  expect(h.assign).toHaveBeenCalledExactlyOnceWith(
    INSTANCE.origin + "/authorize#d=" + encodeURIComponent(h.handle.url),
  );
  expect(h.opener.value).toBeNull();
  expect(JSON.parse(h.data.get(KEY)!)).toMatchObject({
    v: 1,
    attemptId: h.context.attemptId,
    state: "delegated:" + h.handle.url,
    instance: INSTANCE.origin,
    createdAt: 0,
  });
  expect(h.handle.polls).toBe(0);
  expect(h.handle.frees).toBe(0);
  expect(h.controller.getState()).toMatchObject({ status: "redirecting", instance: INSTANCE });
  expect(h.diagnostic).not.toHaveBeenCalled();
  h.navigation.navigate(1);
  expect(h.assign).toHaveBeenCalledOnce();
  expect(h.handle.saves).toBe(1);
});

test.each(["page", "setter", "ignored-setter", "getter", "assign"] as const)(
  "%s failure returns constant internal without cause and deletes the saved record",
  async (stage) => {
    const h = setup();
    const thrown = () => {
      throw new Error(PRIVATE);
    };
    if (stage === "page") h.options.page = thrown;
    if (stage === "setter") h.set.mockImplementation(thrown);
    if (stage === "ignored-setter") h.set.mockImplementation(() => {});
    if (stage === "getter") h.get.mockImplementation(thrown);
    if (stage === "assign") h.assign.mockImplementation(thrown);
    const result = await h.signIn();
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "internal", message: "Safe native failure" },
    });
    if (result.status === "failed") expect(result.error.cause).toBeUndefined();
    expect(
      JSON.stringify([result, h.controller.getState(), h.diagnostic.mock.calls]),
    ).not.toContain(PRIVATE);
    expect(h.data.has(KEY)).toBe(false);
    expect(h.controller.completeRedirect).not.toHaveBeenCalled();
    expect(h.assign).toHaveBeenCalledTimes(stage === "assign" ? 1 : 0);
    expect(h.handle.polls).toBe(0);
    expect(h.handle.frees).toBe(1);
    expect(h.diagnostic).not.toHaveBeenCalled();
  },
);

test.each(["blocked", "preferred"] as const)(
  "storage refusal keeps the %s failure policy",
  async (cause) => {
    const h = setup();
    h.storage.setItem.mockImplementation(() => {
      throw new Error(PRIVATE);
    });
    const result = await h.signIn(cause);
    expect(result).toMatchObject({
      status: "failed",
      error: { code: cause === "blocked" ? "popup_blocked" : "unsupported_environment" },
    });
    expect(h.diagnostic).toHaveBeenCalledExactlyOnceWith({
      code: "redirect_unavailable",
      attemptId: h.context.attemptId,
    });
    expect(h.set).not.toHaveBeenCalled();
    expect(h.assign).not.toHaveBeenCalled();
    expect(h.handle.frees).toBe(1);
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
  },
);

test("a failed readback never severs or navigates and cleanup removes its partial record", async () => {
  const h = setup();
  h.storage.getItem.mockImplementationOnce(() => {
    throw new Error(PRIVATE);
  });
  expect(await h.signIn()).toMatchObject({
    status: "failed",
    error: { code: "unsupported_environment" },
  });
  expect(h.set).not.toHaveBeenCalled();
  expect(h.assign).not.toHaveBeenCalled();
  expect(h.data.has(KEY)).toBe(false);
});

test("a delegation refusal fails: no key is ever saved in this tab's storage", async () => {
  const h = setup();
  vi.spyOn(h.handle, "saveDelegated").mockImplementation(() => {
    throw { name: "ClientStateError", message: PRIVATE };
  });
  const result = await h.signIn();
  expect(result).toMatchObject({ status: "failed", error: { code: "unsupported_environment" } });
  expect(h.data.has(KEY)).toBe(false);
  expect(h.assign).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain(PRIVATE);
});

test("the callbacks bring the person back to this page, marked with the attempt", async () => {
  const h = setup(false);
  const start = vi.spyOn(h.flows, "create");
  h.signIn();
  await flush();
  expect(start).toHaveBeenCalledWith(1, INSTANCE, {
    xSuccess: `${APP}/return?pubky-passport=s.${h.context.attemptId}`,
    xError: `${APP}/return?pubky-passport=e.${h.context.attemptId}`,
    xCancel: `${APP}/return?pubky-passport=c.${h.context.attemptId}`,
  });
});

test("a registry pin mismatch never reads its URL, saves or navigates", async () => {
  const h = setup(false);
  h.signIn();
  await flush();
  vi.spyOn(h.flows, "instance").mockReturnValue(DEFAULT);
  const url = vi.spyOn(h.flows, "authorizationUrl");
  h.navigation.navigate(1);
  expect(h.controller.getState()).toMatchObject({ status: "failed", error: { code: "internal" } });
  expect(url).not.toHaveBeenCalled();
  expect(h.handle.saves).toBe(0);
  expect(h.assign).not.toHaveBeenCalled();
});

test("stale, uncreated and ended flow commands do no native or storage work", async () => {
  const h = setup(false);
  h.navigation.navigate(1);
  const result = h.signIn();
  h.navigation.navigate(1);
  await flush();
  h.navigation.navigate(2);
  h.controller.cancel();
  h.order.length = 0;
  h.navigation.navigate(1);
  expect(h.order).toEqual([]);
  expect(h.handle.saves).toBe(0);
  expect(h.assign).not.toHaveBeenCalled();
  expect(await result).toMatchObject({ status: "failed", error: { code: "cancelled" } });
});

test("reentrant navigation attempts cannot save or assign twice", async () => {
  const h = setup();
  h.set.mockImplementation((value) => {
    h.opener.value = value;
    h.navigation.navigate(1);
  });
  h.assign.mockImplementation(() => h.navigation.navigate(1));
  expect(await h.signIn()).toEqual({ status: "redirecting" });
  expect(h.handle.saves).toBe(1);
  expect(h.assign).toHaveBeenCalledOnce();
});

test("a cancellation in the storage boundary discards the captured record without navigating", async () => {
  const h = setup(false);
  const result = h.signIn();
  await flush();
  h.storage.setItem.mockImplementation((key, value) => {
    h.controller.cancel();
    h.data.set(key, value);
  });
  h.navigation.navigate(1);
  expect(await result).toMatchObject({ status: "failed", error: { code: "cancelled" } });
  expect(h.data.has(KEY)).toBe(false);
  expect(h.assign).not.toHaveBeenCalled();
});

test.each(["save", "storage", "page", "setter", "getter", "assign"] as const)(
  "cancellation queued inside %s prevents a successful native commit",
  async (stage) => {
    const h = setup();
    if (stage === "save") {
      const original = vi.mocked(h.handle.saveDelegated).getMockImplementation()!;
      vi.mocked(h.handle.saveDelegated).mockImplementation(() => {
        h.controller.cancel();
        return original();
      });
    }
    if (stage === "storage")
      h.storage.setItem.mockImplementation((key, value) => {
        h.controller.cancel();
        h.data.set(key, value);
      });
    if (stage === "page")
      h.options.page = () => {
        h.controller.cancel();
        return h.page;
      };
    if (stage === "setter")
      h.set.mockImplementation((value) => {
        h.controller.cancel();
        h.opener.value = value;
      });
    if (stage === "getter")
      h.get.mockImplementation(() => {
        h.controller.cancel();
        return h.opener.value;
      });
    if (stage === "assign") h.assign.mockImplementation(() => h.controller.cancel());
    expect(await h.signIn()).toMatchObject({
      status: "failed",
      error: { code: "cancelled", detail: { by: "app" } },
    });
    expect(h.assign).toHaveBeenCalledTimes(stage === "assign" ? 1 : 0);
    expect(h.data.has(KEY)).toBe(false);
    expect(h.handle.polls).toBe(0);
    expect(h.handle.frees).toBe(1);
    expect(h.diagnostic).not.toHaveBeenCalled();
  },
);

test("cancellation already queued before native commit does not save a delegated key", async () => {
  const h = setup();
  const navigate = h.navigation.navigate.bind(h.navigation);
  vi.spyOn(h.navigation, "navigate").mockImplementationOnce((flowId) => {
    h.controller.cancel();
    navigate(flowId);
  });
  expect(await h.signIn()).toMatchObject({ status: "failed", error: { code: "cancelled" } });
  expect(h.handle.saves).toBe(0);
  expect(h.assign).not.toHaveBeenCalled();
  expect(h.data.has(KEY)).toBe(false);
});

test.each([undefined, false, 0, "", {}])(
  "an opener readback of %j is not verified severance",
  async (value) => {
    const h = setup();
    h.get.mockReturnValue(value);
    expect(await h.signIn()).toMatchObject({
      status: "failed",
      error: { code: "internal", cause: undefined },
    });
    expect(h.assign).not.toHaveBeenCalled();
    expect(h.data.has(KEY)).toBe(false);
  },
);

test("a missing flow URL fails without saving or touching the page", async () => {
  const h = setup(false);
  const result = h.signIn();
  await flush();
  vi.spyOn(h.flows, "authorizationUrl").mockReturnValue(undefined);
  h.navigation.navigate(1);
  expect(await result).toMatchObject({
    status: "failed",
    error: { code: "internal", cause: undefined },
  });
  expect(h.handle.saves).toBe(0);
  expect(h.set).not.toHaveBeenCalled();
  expect(h.assign).not.toHaveBeenCalled();
});

test.each(["foreign", "later-owned"] as const)(
  "stale native cleanup preserves a %s record",
  async (kind) => {
    const h = setup(false);
    const result = h.signIn();
    await flush();
    let newer = "";
    h.options.page = () => {
      const saved = JSON.parse(h.data.get(KEY)!);
      h.controller.cancel();
      newer = JSON.stringify({
        ...saved,
        attemptId: "B".repeat(22),
        ...(kind === "foreign"
          ? { client: JSON.stringify(["Other", "", "other.example", DEFAULT.origin, "optional"]) }
          : {}),
      });
      h.data.set(KEY, newer);
      return h.page;
    };
    h.navigation.navigate(1);
    expect(await result).toMatchObject({ status: "failed", error: { code: "cancelled" } });
    expect(h.data.get(KEY)).toBe(newer);
    expect(h.assign).not.toHaveBeenCalled();
  },
);
