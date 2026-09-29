import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@synonymdev/pubky";
import {
  restoreSavedSession,
  saveSession,
  signOut,
  signupDevelopmentUser,
  startRingAuthFlow,
} from "./pubky";

const sdk = vi.hoisted(() => {
  const kind = { consumed: false, free: vi.fn() };
  const keypair = { free: vi.fn() };
  const key = { free: vi.fn() };
  const signer = { signup: vi.fn(), signin: vi.fn(), free: vi.fn() };
  const stored = { id: "saved-session", free: vi.fn() };
  const store = { save: vi.fn(), restore: vi.fn(), remove: vi.fn(), free: vi.fn() };
  const facade = { startGrantAuthFlow: vi.fn(), signer: vi.fn(), browserSessionStore: store };
  return { kind, keypair, key, signer, stored, store, facade, parseKey: vi.fn() };
});

vi.mock("@synonymdev/pubky", () => {
  const facade = {
    ...sdk.facade,
    startGrantAuthFlow: (...args: unknown[]) => {
      sdk.kind.consumed = true;
      return sdk.facade.startGrantAuthFlow(...args);
    },
  };
  return {
    Pubky: class {
      constructor() {
        return facade;
      }
      static testnet() {
        return facade;
      }
    },
    AuthFlowKind: { signin: () => sdk.kind },
    Keypair: { random: () => sdk.keypair },
    PublicKey: { from: sdk.parseKey },
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function session() {
  return { signout: vi.fn().mockResolvedValue(undefined), free: vi.fn() };
}

beforeEach(() => {
  vi.resetAllMocks();
  sdk.kind.consumed = false;
  sdk.kind.free.mockImplementation(() => {
    if (sdk.kind.consumed) throw new Error("consumed kind must not be freed");
  });
  localStorage.clear();
  sdk.facade.signer.mockReturnValue(sdk.signer);
  sdk.parseKey.mockReturnValue(sdk.key);
  sdk.store.save.mockResolvedValue(sdk.stored);
  sdk.store.remove.mockResolvedValue(undefined);
});

afterEach(() => {
  expect(sdk.kind.free).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("temporary Ring flow ownership", () => {
  it("keeps a canceled pending flow alive, then revokes and frees its late Session", async () => {
    const pending = deferred<Session>();
    const handle = {
      authorizationUrl: "pubkyauth://signin",
      awaitApproval: vi.fn(() => pending.promise),
      free: vi.fn(),
    };
    sdk.facade.startGrantAuthFlow.mockResolvedValue(handle);
    const flow = await startRingAuthFlow();
    flow.cancel();
    flow.cancel();
    expect(handle.free).not.toHaveBeenCalled();
    const late = session();
    const rejected = expect(flow.awaitApproval).rejects.toMatchObject({ name: "RingAuthCanceled" });
    pending.resolve(late as unknown as Session);
    await rejected;
    expect(late.signout).toHaveBeenCalledOnce();
    expect(late.free).toHaveBeenCalledOnce();
    expect(handle.free).toHaveBeenCalledOnce();
    expect(sdk.kind.consumed).toBe(true);
  });

  it("preserves ordinary approval ownership and frees the settled flow", async () => {
    const approved = session();
    const handle = {
      authorizationUrl: "pubkyauth://signin",
      awaitApproval: vi.fn().mockResolvedValue(approved),
      free: vi.fn(),
    };
    sdk.facade.startGrantAuthFlow.mockResolvedValue(handle);
    const flow = await startRingAuthFlow();
    expect(await flow.awaitApproval).toBe(approved);
    flow.cancel();
    expect(handle.free).toHaveBeenCalledOnce();
    expect(approved.signout).not.toHaveBeenCalled();
    expect(approved.free).not.toHaveBeenCalled();
  });

  it("frees a late Session even when revocation fails", async () => {
    const pending = deferred<Session>();
    const handle = {
      authorizationUrl: "pubkyauth://signin",
      awaitApproval: () => pending.promise,
      free: vi.fn(),
    };
    sdk.facade.startGrantAuthFlow.mockResolvedValue(handle);
    const flow = await startRingAuthFlow();
    flow.cancel();
    const late = session();
    late.signout.mockRejectedValue(new Error("offline"));
    const rejected = expect(flow.awaitApproval).rejects.toMatchObject({ name: "RingAuthCanceled" });
    pending.resolve(late as unknown as Session);
    await rejected;
    expect(late.free).toHaveBeenCalledOnce();
    expect(handle.free).toHaveBeenCalledOnce();
  });

  it("a failed start does not free the kind", async () => {
    const error = new Error("start failed");
    sdk.facade.startGrantAuthFlow.mockRejectedValue(error);
    await expect(startRingAuthFlow()).rejects.toBe(error);
    expect(sdk.kind.consumed).toBe(true);
  });

  it("frees a canceled flow only after an approval failure settles", async () => {
    const pending = deferred<Session>();
    const handle = {
      authorizationUrl: "pubkyauth://signin",
      awaitApproval: () => pending.promise,
      free: vi.fn(),
    };
    sdk.facade.startGrantAuthFlow.mockResolvedValue(handle);
    const flow = await startRingAuthFlow();
    flow.cancel();
    expect(handle.free).not.toHaveBeenCalled();
    const rejected = expect(flow.awaitApproval).rejects.toMatchObject({ name: "RingAuthCanceled" });
    pending.reject(new Error("offline"));
    await rejected;
    expect(handle.free).toHaveBeenCalledOnce();
  });
});

describe("temporary store and signup ownership", () => {
  it("frees the store and stored metadata after saving", async () => {
    await saveSession(session() as unknown as Session);
    expect(sdk.store.free).toHaveBeenCalledOnce();
    expect(sdk.stored.free).toHaveBeenCalledOnce();
    expect(localStorage.getItem("template:session")).toBe("saved-session");
  });

  it("frees the store after failed save", async () => {
    const error = new Error("quota");
    sdk.store.save.mockRejectedValue(error);
    await expect(saveSession(session() as unknown as Session)).rejects.toBe(error);
    expect(sdk.store.free).toHaveBeenCalledOnce();
    expect(sdk.stored.free).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "rolls back saved metadata when its pointer fails (remove fails: %s)",
    async (removeFails) => {
      const error = new Error("localStorage quota");
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw error;
      });
      if (removeFails) sdk.store.remove.mockRejectedValue(new Error("remove failed"));
      await expect(saveSession(session() as unknown as Session)).rejects.toBe(error);
      expect(sdk.store.remove).toHaveBeenCalledExactlyOnceWith("saved-session");
      expect(sdk.stored.free).toHaveBeenCalledOnce();
      expect(sdk.store.free).toHaveBeenCalledOnce();
    },
  );

  it("frees restore handles while leaving the returned Session to the app", async () => {
    const restored = session();
    localStorage.setItem("template:session", "saved-session");
    sdk.store.restore.mockResolvedValue(restored);
    expect(await restoreSavedSession()).toBe(restored);
    expect(sdk.store.free).toHaveBeenCalledOnce();
    expect(restored.free).not.toHaveBeenCalled();
  });

  it("frees stores used for invalid-session recovery and failed removal", async () => {
    localStorage.setItem("template:session", "saved-session");
    sdk.store.restore.mockRejectedValue(
      Object.assign(new Error("expired"), { name: "AuthenticationError" }),
    );
    sdk.store.remove.mockRejectedValue(new Error("missing"));
    expect(await restoreSavedSession()).toBeUndefined();
    expect(localStorage.getItem("template:session")).toBeNull();
    expect(sdk.store.free).toHaveBeenCalledTimes(2);
  });

  it("frees the signed-out Session and removal store", async () => {
    const active = session();
    localStorage.setItem("template:session", "saved-session");
    await signOut(active as unknown as Session);
    expect(active.free).toHaveBeenCalledOnce();
    expect(sdk.store.free).toHaveBeenCalledOnce();
  });

  it.each(["success", "signup", "signin", "parse", "signer"])(
    "frees signup handles on %s",
    async (outcome) => {
      const signedIn = session();
      const error = new Error("failure");
      sdk.signer.signin.mockResolvedValue(signedIn);
      if (outcome === "signup") sdk.signer.signup.mockRejectedValue(error);
      if (outcome === "signin") sdk.signer.signin.mockRejectedValue(error);
      if (outcome === "parse")
        sdk.parseKey.mockImplementation(() => {
          throw error;
        });
      if (outcome === "signer")
        sdk.facade.signer.mockImplementation(() => {
          throw error;
        });
      if (outcome === "success") expect(await signupDevelopmentUser("homeserver")).toBe(signedIn);
      else await expect(signupDevelopmentUser("homeserver")).rejects.toBe(error);
      expect(sdk.keypair.free).toHaveBeenCalledOnce();
      expect(sdk.signer.free).toHaveBeenCalledTimes(outcome === "signer" ? 0 : 1);
      expect(sdk.key.free).toHaveBeenCalledTimes(
        outcome === "parse" || outcome === "signer" ? 0 : 1,
      );
      expect(signedIn.free).not.toHaveBeenCalled();
    },
  );
});
