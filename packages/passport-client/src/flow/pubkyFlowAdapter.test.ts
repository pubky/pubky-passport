// @vitest-environment node
import type { GrantAuthFlow, Session, SessionInfo, PublicKey, Pubky } from "@synonymdev/pubky";
import { afterEach, expect, test, vi } from "vitest";
import { createPubkyFlowAdapter, getSharedPubky, readProfileDocument } from "./pubkyFlowAdapter.js";

type SdkModule = typeof import("@synonymdev/pubky");

const sdk = vi.hoisted(() => {
  const kinds: { consumed: boolean; frees: number; free(): void }[] = [];
  const start = vi.fn();
  const delegated = vi.fn();
  const facade = {
    publicStorage: { get: async () => new Response(null, { status: 404 }), free() {} },
    startGrantAuthFlow: start,
    resumeDelegatedGrantAuthFlow: delegated,
  };
  const testnetFacade = { ...facade };
  return {
    kinds,
    start,
    delegated,
    facade,
    testnetFacade,
    constructors: vi.fn(),
    clients: vi.fn(),
    withClient: vi.fn(),
  };
});
vi.mock("@synonymdev/pubky", async (importOriginal) => {
  const actual = await importOriginal<SdkModule>();
  return {
    ...actual,
    Pubky: class {
      constructor() {
        sdk.constructors();
        return sdk.facade;
      }
      static withClient(client: unknown) {
        sdk.withClient(client);
        return sdk.testnetFacade;
      }
    },
    Client: class {
      constructor(config: unknown) {
        sdk.clients(config);
      }
    },
    AuthFlowKind: {
      signin() {
        const kind = {
          consumed: false,
          frees: 0,
          free() {
            this.frees++;
            if (this.consumed) throw new Error("free after consumption");
          },
        };
        sdk.kinds.push(kind);
        return kind;
      },
    },
  };
});
const CANARY = ["private", "sdk", "payload"].join("-");
const flow = Object.freeze({
  authorizationUrl: "pubkyauth://" + CANARY,
}) as unknown as GrantAuthFlow;
const instance = { host: "custom.example", isCustom: true };
const options = {
  appName: "Example",
  clientId: "app.example",
  capabilities: "/pub/app/:rw",
  pubky: sdk.facade as unknown as Pubky,
};
const adapter = () =>
  createPubkyFlowAdapter(options, {
    instance,
    context: { defaultHost: "default.example", appName: "Example" },
  });
afterEach(() => {
  for (const kind of sdk.kinds.splice(0)) expect(kind.frees).toBe(kind.consumed ? 0 : 1);
  sdk.start.mockReset();
  sdk.delegated.mockReset();
});
function consumingStart(outcome: () => unknown = () => flow) {
  sdk.start.mockImplementation((_caps, kind) => {
    kind.consumed = true;
    return outcome();
  });
}

test("a named SDK failure with the mismatch text still owns its consumed kind", async () => {
  consumingStart(() => {
    throw Object.assign(new Error("expected instance of AuthFlowKind"), { name: "RequestError" });
  });
  expect(await adapter().start()).toMatchObject({ ok: false, error: { code: "network" } });
  expect(sdk.kinds[0]!.frees).toBe(0);
});

test("throwing SDK error getters cannot trigger unsafe consumed-kind cleanup", async () => {
  consumingStart(() => {
    throw {
      name: "Error",
      get message() {
        throw new Error(CANARY);
      },
    };
  });
  const result = await adapter().start();
  expect(result).toMatchObject({ ok: false, error: { code: "internal" } });
  expect(sdk.kinds[0]!.frees).toBe(0);
  expect(JSON.stringify(result)).not.toContain(CANARY);
});

test("adapter construction is lazy and every default call shares one facade", async () => {
  const defaults = {
    appName: options.appName,
    clientId: options.clientId,
    capabilities: options.capabilities,
  };
  const a = createPubkyFlowAdapter(defaults);
  const b = createPubkyFlowAdapter(defaults);
  expect(sdk.constructors).not.toHaveBeenCalled();
  consumingStart();
  expect(await a.start()).toEqual({ ok: true, value: flow });
  expect(await b.start()).toEqual({ ok: true, value: flow });
  expect(getSharedPubky()).toBe(sdk.facade);
  expect(await readProfileDocument("y".repeat(52))).toEqual({ kind: "missing" });
  expect(sdk.constructors).toHaveBeenCalledOnce();
});

test("configured relays get their own shared SDK client and the request's relay", async () => {
  const relays = ["https://app.example/_pubky/pkarr", "http://localhost:15411"];
  const a = createPubkyFlowAdapter({
    appName: options.appName,
    clientId: options.clientId,
    capabilities: options.capabilities,
    pkarrRelays: relays,
    httpRelay: "https://app.example/_pubky/relay/inbox",
  });
  expect(sdk.withClient).not.toHaveBeenCalled();
  consumingStart();
  expect(await a.start()).toEqual({ ok: true, value: flow });
  expect(sdk.clients).toHaveBeenCalledExactlyOnceWith({ pkarr: { relays } });
  expect(sdk.start).toHaveBeenCalledWith(options.capabilities, sdk.kinds[0], {
    clientId: "app.example",
    relay: "https://app.example/_pubky/relay/inbox",
    xCallback: { xSource: "Example" },
  });
  // One client per relay set; the mainnet default stays separate.
  expect(getSharedPubky(relays)).toBe(sdk.testnetFacade);
  expect(getSharedPubky()).toBe(sdk.facade);
  expect(await readProfileDocument("y".repeat(52), undefined, relays)).toEqual({
    kind: "missing",
  });
  expect(sdk.withClient).toHaveBeenCalledOnce();
});

test("popup and Ring start carry source metadata without callback destinations", async () => {
  consumingStart();
  const result = await adapter().start();
  expect(result).toEqual({ ok: true, value: flow });
  expect(sdk.start).toHaveBeenCalledWith(options.capabilities, sdk.kinds[0], {
    clientId: "app.example",
    xCallback: { xSource: "Example" },
  });
});

test("same-tab callbacks are passed exactly, on the SDK's default relay", async () => {
  consumingStart();
  const callbacks = {
    xSuccess: "https://app.example/return#s",
    xCancel: "https://app.example/return#c",
    xError: "https://app.example/return#e",
  };
  const a = createPubkyFlowAdapter(options);
  expect(await a.start(callbacks)).toEqual({ ok: true, value: flow });
  expect(sdk.start).toHaveBeenCalledWith(options.capabilities, sdk.kinds[0], {
    clientId: "app.example",
    xCallback: { ...callbacks, xSource: "Example" },
  });
});

test.each(["InvalidInput", "RequestError", "AuthenticationError", "InternalError"])(
  "a consumed kind is never freed after %s",
  async (name) => {
    consumingStart(() => {
      throw Object.assign(new Error(CANARY), { name });
    });
    const result = await adapter().start();
    expect(result).toMatchObject({
      ok: false,
      error: { code: name === "RequestError" ? "network" : "internal" },
    });
    expect(JSON.stringify(result)).not.toContain(CANARY);
  },
);

test("the exact foreign-kind failure frees only the unconsumed wrapper and diagnoses SDK duplication", async () => {
  sdk.start.mockRejectedValue(new Error("expected instance of AuthFlowKind"));
  expect(await adapter().start()).toMatchObject({
    ok: false,
    error: { code: "internal" },
    diagnostic: "sdk_duplicate_suspected",
  });
});

test("a different duplicate-type failure does not free an already consumed kind", async () => {
  consumingStart(() => {
    throw new Error("expected instance of GrantAuthFlow");
  });
  expect(await adapter().start()).toMatchObject({
    ok: false,
    diagnostic: "sdk_duplicate_suspected",
  });
});

test("a failing facade method getter is handled before allocating a kind", async () => {
  const a = createPubkyFlowAdapter({
    ...options,
    pubky: {
      get startGrantAuthFlow() {
        throw new Error(CANARY);
      },
    } as unknown as Pubky,
  });
  expect(await a.start()).toMatchObject({ ok: false, error: { code: "internal" } });
  expect(sdk.kinds).toHaveLength(0);
});

test("resume returns the same handle and passes the delegated state only to the SDK", async () => {
  sdk.delegated.mockResolvedValue(flow);
  expect(await adapter().resume(CANARY)).toEqual({ ok: true, value: flow });
  expect(sdk.delegated).toHaveBeenCalledExactlyOnceWith(CANARY);
  expect(sdk.kinds).toHaveLength(0);
});

test("resume contains an SDK failure", async () => {
  sdk.delegated.mockRejectedValue(new Error(CANARY));
  const result = await adapter().resume(CANARY);
  expect(result).toMatchObject({ ok: false, error: { code: "internal" } });
  expect(JSON.stringify(result)).not.toContain(CANARY);
});

test("mapped runtime errors keep the caller's message context", async () => {
  consumingStart(() => {
    throw Object.assign(new Error(CANARY), { name: "RequestError" });
  });
  const a = createPubkyFlowAdapter(options, {
    instance,
    messages: {
      "error.network": (context) =>
        `${context.appName} at ${context.instanceHost}; default ${context.defaultHost}`,
    },
    context: { appName: "Example", defaultHost: "default.example" },
  });
  expect(await a.start()).toMatchObject({
    ok: false,
    error: { message: "Example at custom.example; default default.example" },
  });
});

function metadata(
  failure?: "info" | "key" | "z32" | "caps" | "key-free" | "info-free",
  error: unknown = new Error(CANARY),
) {
  const fail = () => {
    throw error;
  };
  const key = {
    z32: failure === "z32" ? fail : () => "approved-key",
    free: vi.fn(failure === "key-free" ? fail : () => {}),
  } as unknown as PublicKey;
  const info = {
    get publicKey() {
      return failure === "key" ? fail() : key;
    },
    get capabilities() {
      return failure === "caps" ? fail() : ["/pub/app/:rw"];
    },
    free: vi.fn(failure === "info-free" ? fail : () => {}),
  } as unknown as SessionInfo;
  const session = {
    get info() {
      return failure === "info" ? fail() : info;
    },
    free: vi.fn(),
    signout: vi.fn(),
  } as unknown as Session;
  return { session, key, info };
}
test("Session metadata is copied and nested handles freed without consuming the app's Session", () => {
  const h = metadata();
  const result = adapter().sessionInfo(h.session);
  expect(result).toEqual({
    ok: true,
    value: { publicKey: "approved-key", capabilities: ["/pub/app/:rw"] },
  });
  expect(h.key.free).toHaveBeenCalledOnce();
  expect(h.info.free).toHaveBeenCalledOnce();
  expect(h.session.free).not.toHaveBeenCalled();
  expect(h.session.signout).not.toHaveBeenCalled();
  if (result.ok) {
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.capabilities)).toBe(true);
  }
});
test.each(["info", "key", "z32", "caps", "key-free", "info-free"] as const)(
  "metadata failure at %s frees every acquired nested handle and exposes no raw error",
  (failure) => {
    const h = metadata(failure);
    const result = adapter().sessionInfo(h.session);
    expect(result).toMatchObject({ ok: false, error: { code: "internal" } });
    expect(h.info.free).toHaveBeenCalledTimes(failure === "info" ? 0 : 1);
    expect(h.key.free).toHaveBeenCalledTimes(failure === "info" || failure === "key" ? 0 : 1);
    expect(h.session.free).not.toHaveBeenCalled();
    expect(h.session.signout).not.toHaveBeenCalled();
    if (!result.ok)
      for (const value of [
        JSON.stringify(result),
        String(result.error.cause),
        result.error.stack,
        result.error.cause?.stack,
      ])
        expect(value).not.toContain(CANARY);
  },
);

test.each(
  (["info", "key", "z32", "caps", "key-free", "info-free"] as const).flatMap((failure) =>
    (["PkarrError", "AuthenticationError", "RequestError"] as const).map((name) => ({
      failure,
      name,
    })),
  ),
)("metadata $name at $failure uses start mapping and the caller's copy", ({ failure, name }) => {
  const h = metadata(failure, Object.assign(new Error(CANARY), { name }));
  const message = (context: { appName?: string; instanceHost?: string; defaultHost?: string }) =>
    `${context.appName} at ${context.instanceHost}; default ${context.defaultHost}`;
  const a = createPubkyFlowAdapter(options, {
    instance,
    messages: { "error.internal": message, "error.network": message },
    context: { appName: "Example", defaultHost: "default.example" },
  });
  const result = a.sessionInfo(h.session);
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: name === "RequestError" ? "network" : "internal",
      message: "Example at custom.example; default default.example",
      cause: { name: "PassportErrorCause", message: name },
      detail: { sdkError: name },
    },
  });
  expect(h.info.free).toHaveBeenCalledTimes(failure === "info" ? 0 : 1);
  expect(h.key.free).toHaveBeenCalledTimes(failure === "info" || failure === "key" ? 0 : 1);
  expect(h.session.free).not.toHaveBeenCalled();
  expect(h.session.signout).not.toHaveBeenCalled();
  if (!result.ok) {
    expect(result).not.toHaveProperty("value");
    for (const value of [JSON.stringify(result), result.error.stack, result.error.cause?.stack])
      expect(value).not.toContain(CANARY);
  }
});

test("a metadata constructor mismatch keeps the duplicate diagnostic without raw text", () => {
  const h = metadata("info", new Error(`expected instance of Session: ${CANARY}`));
  const result = adapter().sessionInfo(h.session);
  expect(result).toMatchObject({
    ok: false,
    error: { code: "internal" },
    diagnostic: "sdk_duplicate_suspected",
  });
  expect(JSON.stringify(result)).not.toContain(CANARY);
  expect(h.key.free).not.toHaveBeenCalled();
  expect(h.info.free).not.toHaveBeenCalled();
  expect(h.session.free).not.toHaveBeenCalled();
});
