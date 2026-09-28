import { GrantAuthFlow, Pubky, type BrowserSessionStore, type Session } from "@synonymdev/pubky";
import { afterEach, expect, it, vi } from "vitest";
import { expectResultOk } from "@test-utils/resultAssertions";
import { holdDelegatedKeys } from "./delegatedGrantKeys";
import { PubkyRingProfileTransport } from "./PubkySdkAdapter";
import { PROFILE_CAPABILITIES, PROFILE_PATH, type ProfileWrite } from "../profile/profile";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const RELAY = "https://relay.passport.example/inbox";
const WRITES: ProfileWrite[] = [{ kind: "json", path: PROFILE_PATH, json: { name: "Satoshi" } }];
afterEach(() => vi.restoreAllMocks());
function setup(capabilities: string[] = [...PROFILE_CAPABILITIES]) {
  const storage = { putJson: vi.fn(async () => undefined), free: vi.fn() };
  const approved = {
    info: { capabilities, publicKey: { z32: () => KEY, free: vi.fn() }, free: vi.fn() },
    storage,
    signout: vi.fn(async () => undefined),
    free: vi.fn(),
  };
  const flow = {
    authorizationUrl: "pubkyauth://signin?secret=profile-only",
    tryPollOnce: vi.fn(async (): Promise<Session | undefined> => undefined),
    free: vi.fn(),
  };
  const start = vi
    .spyOn(Pubky.prototype, "startGrantAuthFlow")
    .mockImplementation(async (_caps, kind) => {
      kind.free(); // Mirror SDK ownership of the passed kind.
      return flow as unknown as GrantAuthFlow;
    });
  const signer = vi.spyOn(Pubky.prototype, "signer");
  return { storage, approved, flow, start, signer };
}
async function connect() {
  return expectResultOk(await new PubkyRingProfileTransport().start(RELAY));
}
/** A browser whose flows use delegated keys, with the SDK's key store observed. */
function delegatedKeyStore() {
  vi.spyOn(GrantAuthFlow, "isDelegationAvailable", "get").mockReturnValue(true);
  const store = { clearAll: vi.fn(async () => undefined), free: vi.fn() };
  vi.spyOn(Pubky.prototype, "browserSessionStore", "get").mockReturnValue(
    store as unknown as BrowserSessionStore,
  );
  return store;
}

it("requests only profile and avatar permissions and publishes with the approved delegated session", async () => {
  const { flow, start, signer, approved, storage } = setup();
  const connection = await connect();
  expect(start).toHaveBeenCalledWith(
    PROFILE_CAPABILITIES.join(","),
    expect.anything(),
    expect.objectContaining({
      // Passport's own grants use the instance's configured relay, never the SDK default.
      relay: RELAY,
      xCallback: { xSource: "Pubky Passport profile" },
    }),
  );
  expect(connection.authorizationUrl()).toBe(flow.authorizationUrl);
  expect(expectResultOk(await connection.poll())).toBeUndefined();
  expect(await connection.publish(KEY, WRITES)).toMatchObject({
    error: { code: "grant_unavailable" },
  });
  flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
  expect(expectResultOk(await connection.poll())).toBe(KEY);
  expect(connection.authorizationUrl()).toBeUndefined();
  expectResultOk(await connection.publish(KEY, WRITES));
  expect(storage.putJson).toHaveBeenCalledWith(PROFILE_PATH, { name: "Satoshi" });
  expect(storage.free).toHaveBeenCalledOnce();
  expect(signer).not.toHaveBeenCalled();
  await connection.dispose();
  await connection.dispose();
  expect(approved.signout).toHaveBeenCalledOnce();
  expect(approved.free).toHaveBeenCalledOnce();
  expect(flow.free).toHaveBeenCalledOnce();
});

it("rejects incomplete grants and attempts to publish for another identity", async () => {
  const { approved, flow, storage } = setup([PROFILE_CAPABILITIES[0]]);
  const connection = await connect();
  flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
  expect(await connection.poll()).toMatchObject({ error: { code: "missing_capabilities" } });
  expect(await connection.publish(KEY, WRITES)).toMatchObject({
    error: { code: "grant_unavailable" },
  });
  expect(storage.putJson).not.toHaveBeenCalled();
  await connection.dispose();
  expect(approved.signout).toHaveBeenCalledOnce();
});

it("reports relay failures and a revoked grant as results", async () => {
  const { approved, flow, storage } = setup();
  const connection = await connect();
  flow.tryPollOnce.mockRejectedValueOnce(new Error("relay offline"));
  expect(await connection.poll()).toMatchObject({ error: { code: "grant_failed" } });
  flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
  expect(expectResultOk(await connection.poll())).toBe(KEY);
  storage.putJson.mockRejectedValueOnce({ name: "RequestError", data: { statusCode: 403 } });
  expect(await connection.publish(KEY, WRITES)).toMatchObject({
    error: { code: "publish_unauthorized" },
  });
  await connection.dispose();
});

it("reports a failed request as a result and releases its client", async () => {
  vi.spyOn(Pubky.prototype, "startGrantAuthFlow").mockRejectedValue(new Error("offline"));
  const free = vi.spyOn(Pubky.prototype, "free");
  expect(await new PubkyRingProfileTransport().start(RELAY)).toMatchObject({
    error: { code: "grant_failed" },
  });
  expect(free).toHaveBeenCalledOnce();
});

it("waits for a pending SDK operation before freeing a cancelled connection", async () => {
  const { approved, flow } = setup();
  let approve!: (session: Session) => void;
  flow.tryPollOnce.mockImplementation(
    () =>
      new Promise((resolve) => {
        approve = resolve;
      }),
  );
  const connection = await connect();
  const pending = connection.poll();
  await connection.dispose();
  expect(flow.free).not.toHaveBeenCalled();
  approve(approved as unknown as Session);
  expect(expectResultOk(await pending)).toBeUndefined();
  expect(approved.signout).toHaveBeenCalledOnce();
  expect(approved.free).toHaveBeenCalledOnce();
  expect(flow.free).toHaveBeenCalledOnce();
});

it("cleans up after a session storage accessor fails", async () => {
  const { approved, flow } = setup();
  Object.defineProperty(approved, "storage", {
    get() {
      throw new Error("session closed");
    },
  });
  flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
  const connection = await connect();
  await connection.poll();
  expect(await connection.publish(KEY, WRITES)).toMatchObject({
    error: { code: "publish_failed" },
  });
  await connection.dispose();
  expect(approved.free).toHaveBeenCalledOnce();
  expect(flow.free).toHaveBeenCalledOnce();
});

it("constructs a real SDK profile request without retaining or double-freeing its consumed kind", async () => {
  const connection = await connect();
  try {
    const request = new URL(connection.authorizationUrl()!);
    expect(request.protocol).toBe("pubkyauth:");
    expect(request.searchParams.get("caps")?.split(",")).toEqual(PROFILE_CAPABILITIES);
    expect(request.searchParams.get("x-source")).toBe("Pubky Passport profile");
  } finally {
    await connection.dispose();
  }
});

it("accepts a grant broader than the write-only request", async () => {
  const { approved, flow } = setup([
    "/pub/pubky.app/profile.json:rw",
    "/pub/pubky.app/files/:rw",
    "/pub/pubky.app/blobs/:w",
  ]);
  const connection = await connect();
  flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
  expect(expectResultOk(await connection.poll())).toBe(KEY);
  await connection.dispose();
});

it.each([
  [
    "a pubky without a homeserver record",
    Object.assign(new Error("Invalid request/URI: could not resolve homeserver for x"), {
      name: "RequestError",
    }),
    "homeserver_unresolved",
  ],
  [
    "a failed PKARR lookup",
    Object.assign(new Error("Failed to resolve the DHT record"), { name: "PkarrError" }),
    "homeserver_unresolved",
  ],
  [
    "a homeserver refusing the grant",
    Object.assign(new Error("401 Unauthorized"), {
      name: "RequestError",
      data: { statusCode: 401 },
    }),
    "grant_rejected",
  ],
  [
    "a homeserver forbidding the grant",
    Object.assign(new Error("403 Forbidden"), {
      name: "RequestError",
      data: { statusCode: 403 },
    }),
    "grant_rejected",
  ],
  [
    "an invalid grant",
    Object.assign(new Error("bad grant"), { name: "AuthenticationError" }),
    "grant_rejected",
  ],
  [
    "a relay entry expiring before approval",
    Object.assign(new Error("Entry expired"), {
      name: "RequestError",
      data: { statusCode: 404 },
    }),
    "grant_failed",
  ],
  [
    "a relay refusing an over-long request id",
    Object.assign(new Error("ID too long"), {
      name: "RequestError",
      data: { statusCode: 400 },
    }),
    "grant_failed",
  ],
  [
    "a relay refusing an over-large body",
    Object.assign(new Error("Payload Too Large"), {
      name: "RequestError",
      data: { statusCode: 413 },
    }),
    "grant_failed",
  ],
  [
    "an unreachable relay or homeserver",
    Object.assign(new Error("HTTP transport error: error sending request"), {
      name: "RequestError",
    }),
    "grant_failed",
  ],
  [
    "a server error",
    Object.assign(new Error("500"), { name: "RequestError", data: { statusCode: 500 } }),
    "grant_failed",
  ],
  [
    "a relay timeout status",
    Object.assign(new Error("408"), { name: "RequestError", data: { statusCode: 408 } }),
    "grant_failed",
  ],
])("reports %s after polling as %s", async (_label, error, code) => {
  const { flow } = setup();
  const connection = await connect();
  flow.tryPollOnce.mockRejectedValueOnce(error);
  expect(await connection.poll()).toMatchObject({ error: { code } });
  await connection.dispose();
});

it("clears the browser's delegated keys once its grant is revoked and no other grant holds them", async () => {
  const store = delegatedKeyStore();
  const { approved, flow } = setup();
  const connection = await connect();
  // Leftover keys are cleared before a new request creates its own key.
  expect(store.clearAll).toHaveBeenCalledOnce();
  expect(store.free).toHaveBeenCalledOnce();
  flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
  await connection.poll();

  const otherTab = await holdDelegatedKeys();
  await connection.dispose();
  expect(approved.signout).toHaveBeenCalledOnce();
  // Another grant still signs with its key, so nothing is deleted under it.
  expect(store.clearAll).toHaveBeenCalledOnce();
  await otherTab();

  const next = await connect();
  expect(store.clearAll).toHaveBeenCalledTimes(2);
  await next.dispose();
  expect(store.clearAll).toHaveBeenCalledTimes(3);
  expect(store.free).toHaveBeenCalledTimes(3);
});

it("keeps a new request's key while the replaced connection finishes its cleanup", async () => {
  const store = delegatedKeyStore();
  const { approved, flow } = setup();
  const first = await connect();
  flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
  await first.poll();
  let finishSignout!: () => void;
  approved.signout.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishSignout = () => resolve(undefined);
      }),
  );
  const disposing = first.dispose();
  const second = await connect();
  store.clearAll.mockClear();
  finishSignout();
  await disposing;
  expect(store.clearAll).not.toHaveBeenCalled();
  await second.dispose();
  expect(store.clearAll).toHaveBeenCalledOnce();
});

it("logs a failed key cleanup without failing the request or its disposal", async () => {
  const store = delegatedKeyStore();
  store.clearAll.mockRejectedValue(new Error("IndexedDB unavailable"));
  setup();
  const connection = await connect();
  expect(connection.authorizationUrl()).toBe("pubkyauth://signin?secret=profile-only");
  await expect(connection.dispose()).resolves.toBeUndefined();
  expect(store.free).toHaveBeenCalledTimes(2);
});

it("leaves the browser's key store alone where flows cannot use delegated keys", async () => {
  vi.spyOn(GrantAuthFlow, "isDelegationAvailable", "get").mockReturnValue(false);
  const store = vi.spyOn(Pubky.prototype, "browserSessionStore", "get");
  setup();
  const connection = await connect();
  await connection.dispose();
  expect(store).not.toHaveBeenCalled();
});
