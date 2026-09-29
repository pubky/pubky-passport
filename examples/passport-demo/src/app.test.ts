import { beforeEach, expect, it, vi } from "vitest";
import { start } from "./app";

const sdk = vi.hoisted(() => ({
  start: vi.fn(),
  save: vi.fn(),
  signin: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("qrcode", () => ({ toCanvas: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@synonymdev/pubky", () => {
  const free = () => {};
  const facade = {
    startGrantAuthFlow: sdk.start,
    browserSessionStore: { save: sdk.save, remove: sdk.remove, free },
    signer: () => ({ signup: async () => {}, signin: sdk.signin, free }),
  };
  return {
    Pubky: class {
      static testnet() {
        return facade;
      }
    },
    Keypair: { random: () => ({ free }) },
    PublicKey: { from: () => ({ free }) },
    AuthFlowKind: { signin: () => ({ free }) },
    PubkyResource: {},
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function session(key: string) {
  const publicKey = { toString: () => key, free: vi.fn() };
  const info = { publicKey, free: vi.fn() };
  const storage = { list: vi.fn().mockResolvedValue([]), free: vi.fn() };
  return { info, storage, signout: vi.fn().mockResolvedValue(undefined), free: vi.fn() };
}

function signup() {
  document
    .querySelector("#development-signup-form")!
    .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sdk.remove.mockResolvedValue(undefined);
  document.body.replaceChildren(document.createElement("div"));
  sdk.save.mockResolvedValue({ id: "saved", free: vi.fn() });
});

it("discards an already-approved Ring Session from a start superseded by signup", async () => {
  const pendingStart = deferred<unknown>();
  const signedUp = session("signup-user");
  const late = session("late-user");
  sdk.start.mockReturnValueOnce(pendingStart.promise);
  sdk.signin.mockResolvedValueOnce(signedUp);
  start(document.body.firstElementChild as HTMLElement);
  await vi.waitFor(() => expect(sdk.start).toHaveBeenCalledOnce());
  signup();
  await vi.waitFor(() =>
    expect(document.querySelector(".pubky-id")?.textContent).toBe("signup-user"),
  );
  pendingStart.resolve({
    authorizationUrl: "pubkyauth://signin",
    awaitApproval: async () => late,
    free: vi.fn(),
  });
  await vi.waitFor(() => expect(late.signout).toHaveBeenCalledOnce());
  expect(late.free).toHaveBeenCalledOnce();
  expect(document.querySelector(".pubky-id")?.textContent).toBe("signup-user");
  expect(signedUp.info.free).toHaveBeenCalledOnce();
  expect(signedUp.info.publicKey.free).toHaveBeenCalledOnce();
});

it("discards a Ring Session when saving it fails", async () => {
  // Each import gives the template's module-owned UI state a fresh lifetime.
  vi.resetModules();
  const { start: startFresh } = await import("./app");
  const approved = session("ring-user");
  sdk.start.mockResolvedValueOnce({
    authorizationUrl: "pubkyauth://signin",
    awaitApproval: async () => approved,
    free: vi.fn(),
  });
  sdk.save.mockRejectedValueOnce(new Error("storage unavailable"));
  startFresh(document.body.firstElementChild as HTMLElement);
  await vi.waitFor(() => expect(approved.signout).toHaveBeenCalledOnce());
  expect(approved.free).toHaveBeenCalledOnce();
  expect(document.querySelector(".pubky-id")).toBeNull();
  expect(document.querySelector("#status")?.textContent).toContain("storage unavailable");
});

it("serializes overlapping Ring and signup activation and retires the replaced Session once", async () => {
  vi.resetModules();
  const { start: startFresh } = await import("./app");
  const approval = deferred<ReturnType<typeof session>>();
  const signupResult = deferred<ReturnType<typeof session>>();
  const ringRead = deferred<string[]>();
  const signupSave = deferred<void>();
  const ring = session("ring-user");
  const signedUp = session("signup-user");
  let readUsedFreedSession = false;
  ring.storage.list.mockImplementation(() =>
    ringRead.promise.then((files) => {
      readUsedFreedSession = ring.free.mock.calls.length > 0;
      return files;
    }),
  );
  sdk.start.mockResolvedValueOnce({
    authorizationUrl: "pubkyauth://signin",
    awaitApproval: () => approval.promise,
    free: vi.fn(),
  });
  sdk.signin.mockReturnValueOnce(signupResult.promise);
  sdk.save.mockImplementation(async (value) => {
    if (value === signedUp) await signupSave.promise;
    return { id: value.info.publicKey.toString(), free: vi.fn() };
  });
  startFresh(document.body.firstElementChild as HTMLElement);
  await vi.waitFor(() => expect(sdk.start).toHaveBeenCalledOnce());
  signup();
  await vi.waitFor(() => expect(sdk.signin).toHaveBeenCalledOnce());
  approval.resolve(ring);
  await vi.waitFor(() => expect(ring.storage.list).toHaveBeenCalledOnce());
  signupResult.resolve(signedUp);
  await new Promise((resolve) => setTimeout(resolve, 0));
  ringRead.resolve([]);
  await vi
    .waitFor(() => {
      expect(document.querySelector(".pubky-id")?.textContent).toBe("ring-user");
      expect((document.querySelector("#sign-out") as HTMLButtonElement).disabled).toBe(true);
    })
    .finally(() => signupSave.resolve());
  await vi.waitFor(() =>
    expect(document.querySelector(".pubky-id")?.textContent).toBe("signup-user"),
  );
  expect(readUsedFreedSession).toBe(false);
  expect(ring.signout).toHaveBeenCalledOnce();
  expect(ring.free).toHaveBeenCalledOnce();
  expect(signedUp.free).not.toHaveBeenCalled();
  expect(localStorage.getItem("template:session")).toBe("signup-user");
  expect(sdk.remove).toHaveBeenCalledExactlyOnceWith("ring-user");
});
