import {
  GrantAuthFlow,
  Pubky,
  type AuthFlow,
  type BrowserSessionStore,
  type Session,
} from "@synonymdev/pubky";
import { afterEach, expect, it, vi } from "vitest";
import { expectResultOk } from "@test-utils/resultAssertions";
import { holdDelegatedKeys } from "./delegatedGrantKeys";
import { PubkyRingProfileTransport, PubkyRingVerificationTransport } from "./PubkySdkAdapter";
import { PROFILE_CAPABILITIES, PROFILE_PATH, type ProfileWrite } from "../profile/profile";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const OTHER = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const RELAY = "https://relay.passport.example/inbox";
/** Passport's client ID where the page has no `location` (these tests run in Node). */
const CLIENT_ID = "passport.pubky.app";
const WRITES: ProfileWrite[] = [{ kind: "json", path: PROFILE_PATH, json: { name: "Satoshi" } }];
afterEach(() => vi.restoreAllMocks());
/** A Session as the SDK hands it over: its info, its storage, and a sign-out that revokes it. */
function fakeSession(publicKey = KEY, capabilities: readonly string[] = PROFILE_CAPABILITIES) {
  return {
    info: {
      capabilities: [...capabilities],
      publicKey: { z32: () => publicKey, free: vi.fn() },
      free: vi.fn(),
    },
    storage: { putJson: vi.fn(async () => undefined), free: vi.fn() },
    signout: vi.fn(async () => undefined),
    free: vi.fn(),
  };
}
function setup(capabilities: string[] = [...PROFILE_CAPABILITIES]) {
  const approved = fakeSession(KEY, capabilities);
  const storage = approved.storage;
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
/** The backup check's request: it grants nothing and is never stored. */
async function verify() {
  return expectResultOk(await new PubkyRingVerificationTransport().start(RELAY));
}
type StoredRecord = {
  id: string;
  publicKey: string;
  clientId: string;
  capabilities: readonly string[];
  grantExpiresAt: number;
};
/** A stored record of Passport's profile grant for `KEY`, with an hour left. */
function storedGrant(overrides: Partial<StoredRecord> = {}): StoredRecord {
  return {
    id: "stored-grant",
    publicKey: KEY,
    clientId: CLIENT_ID,
    capabilities: PROFILE_CAPABILITIES,
    grantExpiresAt: Date.now() / 1000 + 3_600,
    ...overrides,
  };
}
/**
 * A browser whose flows use delegated keys, with the SDK's session store observed: it keeps
 * `records` in memory, restores each as a Session of its own, and frees every handle it lends.
 */
function delegatedKeyStore({
  available = true,
  records = [],
}: { available?: boolean; records?: StoredRecord[] } = {}) {
  vi.spyOn(GrantAuthFlow, "isDelegationAvailable", "get").mockReturnValue(true);
  const saved = new Map(records.map((record) => [record.id, record]));
  /** Every record handle the store lent out (listed or saved), each to be freed. */
  const handles: { free: ReturnType<typeof vi.fn> }[] = [];
  const lend = (record: StoredRecord) => {
    const handle = { ...record, capabilities: [...record.capabilities], free: vi.fn() };
    handles.push(handle);
    return handle;
  };
  const restored: ReturnType<typeof fakeSession>[] = [];
  const store = {
    saved,
    handles,
    restored,
    isAvailable: vi.fn(async () => available),
    list: vi.fn(async () => [...saved.values()].map(lend)),
    save: vi.fn(async (session: Session) => {
      const record = storedGrant({
        id: `saved-${saved.size + 1}`,
        publicKey: session.info.publicKey.z32(),
        capabilities: session.info.capabilities,
      });
      saved.set(record.id, record);
      return lend(record);
    }),
    restore: vi.fn(async (id: string) => {
      const record = saved.get(id);
      if (!record) throw new Error("No stored session");
      const session = fakeSession(record.publicKey, record.capabilities);
      restored.push(session);
      return session as unknown as Session;
    }),
    remove: vi.fn(async (id: string) => {
      saved.delete(id);
    }),
    clearAll: vi.fn(async () => saved.clear()),
    free: vi.fn(),
  };
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
  // The backup check's grant is never stored, so disposing it revokes it.
  const connection = await verify();
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
  // An unstored grant, whose disposal waits for its revocation.
  const first = await verify();
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

it("asks Ring to verify a key with a request that grants nothing, then signs its Session out", async () => {
  const { flow, start, signer, approved, storage } = setup([]);
  const connection = expectResultOk(await new PubkyRingVerificationTransport().start(RELAY));
  // No capability is asked for, on the instance's relay, under a label of its own.
  expect(start).toHaveBeenCalledWith(
    "",
    expect.anything(),
    expect.objectContaining({
      relay: RELAY,
      xCallback: { xSource: "Pubky Passport backup check" },
    }),
  );
  expect(connection.authorizationUrl()).toBe(flow.authorizationUrl);
  flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
  // An approval granting nothing is complete: what it proves is the key that signed it.
  expect(expectResultOk(await connection.poll())).toBe(KEY);
  // Nothing is ever written with it.
  expect(await connection.publish(KEY, WRITES)).toMatchObject({
    error: { code: "grant_unavailable" },
  });
  expect(storage.putJson).not.toHaveBeenCalled();
  await connection.dispose();
  expect(approved.signout).toHaveBeenCalledOnce();
  expect(approved.free).toHaveBeenCalledOnce();
  expect(flow.free).toHaveBeenCalledOnce();
  expect(signer).not.toHaveBeenCalled();
});

it("stores an approved profile grant only when kept, and keeps it valid when the page lets go", async () => {
  const store = delegatedKeyStore();
  const { approved, flow } = setup();
  const connection = await connect();
  // Nothing is stored yet, so a new request still clears keys left by abandoned flows.
  expect(store.clearAll).toHaveBeenCalledOnce();
  // Nothing to keep before Ring approves.
  await connection.keep();
  expect(expectResultOk(await connection.poll())).toBeUndefined();
  expect(store.save).not.toHaveBeenCalled();
  flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
  expect(expectResultOk(await connection.poll())).toBe(KEY);
  // An approval alone stores nothing: Passport first accepts the identity that gave it.
  expect(store.save).not.toHaveBeenCalled();
  await connection.keep();
  await connection.keep();
  // Kept once, for the approving identity and this origin.
  expect(store.save).toHaveBeenCalledExactlyOnceWith(approved);
  expect([...store.saved.values()]).toEqual([
    expect.objectContaining({ publicKey: KEY, clientId: CLIENT_ID }),
  ]);
  expectResultOk(await connection.publish(KEY, WRITES));
  await connection.dispose();
  // Freed, never signed out: the grant stays valid for the identity's next edit.
  expect(approved.signout).not.toHaveBeenCalled();
  expect(approved.free).toHaveBeenCalledOnce();
  expect(flow.free).toHaveBeenCalledOnce();
  expect(store.saved.size).toBe(1);
  // Its delegated key is kept with the other keys, so none is cleared under it.
  expect(store.clearAll).toHaveBeenCalledOnce();
  for (const handle of store.handles) expect(handle.free).toHaveBeenCalledOnce();
});

it("revokes an approved profile grant that was never kept when the page lets go", async () => {
  const store = delegatedKeyStore();
  const { approved, flow } = setup();
  const connection = await connect();
  flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
  expect(expectResultOk(await connection.poll())).toBe(KEY);
  await connection.dispose();
  expect(store.save).not.toHaveBeenCalled();
  expect(approved.signout).toHaveBeenCalledOnce();
  expect(approved.free).toHaveBeenCalledOnce();
  expect(store.clearAll).toHaveBeenCalledTimes(2);
});

it.each([
  [
    "that can also read",
    [`${PROFILE_PATH}:rw`, "/pub/pubky.app/files/:w", "/pub/pubky.app/blobs/:w"],
  ],
  ["beyond the profile", [...PROFILE_CAPABILITIES, "/pub/other.app/:w"]],
])(
  "never stores an approval %s, and revokes it when the page lets go",
  async (_case, capabilities) => {
    const store = delegatedKeyStore();
    const { approved, flow } = setup(capabilities);
    const connection = await connect();
    flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
    // It covers the profile, so it works for this page.
    expect(expectResultOk(await connection.poll())).toBe(KEY);
    await connection.keep();
    expect(store.save).not.toHaveBeenCalled();
    expect(store.saved.size).toBe(0);
    expectResultOk(await connection.publish(KEY, WRITES));
    await connection.dispose();
    expect(approved.signout).toHaveBeenCalledOnce();
    expect(approved.free).toHaveBeenCalledOnce();
  },
);

it("keeps nothing once the connection is disposed", async () => {
  const store = delegatedKeyStore();
  const { approved, flow } = setup();
  const connection = await connect();
  flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
  await connection.poll();
  await connection.dispose();
  await connection.keep();
  expect(store.save).not.toHaveBeenCalled();
  expect(approved.signout).toHaveBeenCalledOnce();
});

it("waits for a keep in progress before freeing a disposed grant, then leaves it stored", async () => {
  const store = delegatedKeyStore();
  const { approved, flow } = setup();
  const connection = await connect();
  flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
  await connection.poll();
  let saved!: () => void;
  const save = store.save.getMockImplementation()!;
  store.save.mockImplementationOnce(
    (session) =>
      new Promise((resolve) => {
        saved = () => resolve(save(session));
      }),
  );
  const keeping = connection.keep();
  await vi.waitFor(() => expect(store.save).toHaveBeenCalledOnce());
  await connection.dispose();
  expect(approved.free).not.toHaveBeenCalled();
  saved();
  await keeping;
  expect(store.saved.size).toBe(1);
  expect(approved.signout).not.toHaveBeenCalled();
  expect(approved.free).toHaveBeenCalledOnce();
});

it.each([
  ["cannot store sessions", { available: false }, undefined],
  ["fails to store it", {}, new Error("QuotaExceededError")],
])(
  "keeps an approved profile grant for the page only when the browser %s",
  async (_case, options, saveError) => {
    const store = delegatedKeyStore(options);
    if (saveError) store.save.mockRejectedValueOnce(saveError);
    const { approved, flow } = setup();
    const connection = await connect();
    flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
    expect(expectResultOk(await connection.poll())).toBe(KEY);
    // Not storing it fails nothing: the grant works for this page.
    await expect(connection.keep()).resolves.toBeUndefined();
    expectResultOk(await connection.publish(KEY, WRITES));
    expect(store.saved.size).toBe(0);
    await connection.dispose();
    expect(approved.signout).toHaveBeenCalledOnce();
    expect(approved.free).toHaveBeenCalledOnce();
    expect(store.clearAll).toHaveBeenCalledTimes(2);
  },
);

it("never stores the backup check's grant, and signs it out", async () => {
  const store = delegatedKeyStore();
  const { approved, flow } = setup([]);
  const connection = await verify();
  flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
  expect(expectResultOk(await connection.poll())).toBe(KEY);
  await connection.keep();
  await connection.dispose();
  expect(store.save).not.toHaveBeenCalled();
  expect(approved.signout).toHaveBeenCalledOnce();
  expect(approved.free).toHaveBeenCalledOnce();
});

it("never stores the legacy cookie sign-in, and signs it out", async () => {
  const store = delegatedKeyStore();
  const { approved, flow, start } = setup();
  const cookie = vi
    .spyOn(Pubky.prototype, "startCookieAuthFlow")
    .mockImplementation((_caps, kind) => {
      kind.free(); // Mirror SDK ownership of the passed kind.
      return flow as unknown as AuthFlow;
    });
  const connection = expectResultOk(await new PubkyRingProfileTransport().start(RELAY, "cookie"));
  expect(cookie).toHaveBeenCalledWith(PROFILE_CAPABILITIES.join(","), expect.anything(), RELAY, {
    xSource: "Pubky Passport profile",
  });
  expect(start).not.toHaveBeenCalled();
  flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
  expect(expectResultOk(await connection.poll())).toBe(KEY);
  await connection.keep();
  await connection.dispose();
  expect(store.save).not.toHaveBeenCalled();
  expect(approved.signout).toHaveBeenCalledOnce();
  expect(approved.free).toHaveBeenCalledOnce();
});

it("connects the stored grant of an identity again without asking the keychain", async () => {
  const store = delegatedKeyStore({ records: [storedGrant()] });
  const { start } = setup();
  const transport = new PubkyRingProfileTransport();
  expect(await transport.stored(KEY)).toBe(true);
  const grant = expectResultOk(await transport.resume(KEY));
  expect(grant).toBeDefined();
  expect(store.restore).toHaveBeenCalledExactlyOnceWith("stored-grant");
  expect(start).not.toHaveBeenCalled();
  // Connected already: there is nothing to show or approve.
  expect(grant!.authorizationUrl()).toBeUndefined();
  expect(expectResultOk(await grant!.poll())).toBe(KEY);
  const [session] = store.restored;
  expectResultOk(await grant!.publish(KEY, WRITES));
  expect(session!.storage.putJson).toHaveBeenCalledWith(PROFILE_PATH, { name: "Satoshi" });
  // It writes for its own identity only.
  expect(await grant!.publish(OTHER, WRITES)).toMatchObject({
    error: { code: "grant_unavailable" },
  });
  await grant!.keep();
  await grant!.dispose();
  // Still stored and valid for the next edit, and never stored a second time.
  expect(session!.signout).not.toHaveBeenCalled();
  expect(session!.free).toHaveBeenCalledOnce();
  expect(store.save).not.toHaveBeenCalled();
  expect(store.saved.has("stored-grant")).toBe(true);
  expect(store.clearAll).not.toHaveBeenCalled();
  for (const handle of store.handles) expect(handle.free).toHaveBeenCalledOnce();
});

it("holds the browser's delegated keys while a resumed grant is in use", async () => {
  const store = delegatedKeyStore({ records: [storedGrant()] });
  setup();
  const grant = expectResultOk(await new PubkyRingProfileTransport().resume(KEY))!;
  // Even with no record left, keys are not cleared while the resumed grant may still sign.
  store.saved.clear();
  const request = await verify();
  expect(store.clearAll).not.toHaveBeenCalled();
  await request.dispose();
  expect(store.clearAll).not.toHaveBeenCalled();
  await grant.dispose();
  expect(store.clearAll).toHaveBeenCalledOnce();
});

it.each([
  ["another identity's grant", storedGrant({ publicKey: OTHER })],
  ["another origin's grant", storedGrant({ clientId: "other.passport.example" })],
  [
    "a grant that can also read",
    storedGrant({
      capabilities: [`${PROFILE_PATH}:rw`, "/pub/pubky.app/files/:w", "/pub/pubky.app/blobs/:w"],
    }),
  ],
  [
    "a grant beyond the profile",
    storedGrant({ capabilities: [...PROFILE_CAPABILITIES, "/pub/other.app/:w"] }),
  ],
  ["a grant without avatar writes", storedGrant({ capabilities: [`${PROFILE_PATH}:w`] })],
  ["a grant within a minute of expiring", storedGrant({ grantExpiresAt: Date.now() / 1000 + 30 })],
])("never resumes %s", async (_case, record) => {
  const store = delegatedKeyStore({ records: [record] });
  const transport = new PubkyRingProfileTransport();
  expect(expectResultOk(await transport.resume(KEY))).toBeUndefined();
  expect(await transport.stored(KEY)).toBe(false);
  expect(store.restore).not.toHaveBeenCalled();
  // Not Passport's to forget here.
  expect(store.remove).not.toHaveBeenCalled();
  for (const handle of store.handles) expect(handle.free).toHaveBeenCalledOnce();
});

it("forgets expired grants of any identity, and resumes none", async () => {
  const expired = Date.now() / 1000 - 60;
  const store = delegatedKeyStore({
    records: [
      storedGrant({ grantExpiresAt: expired }),
      storedGrant({ id: "other-expired", publicKey: OTHER, grantExpiresAt: expired }),
      storedGrant({ id: "other-grant", publicKey: OTHER }),
    ],
  });
  expect(expectResultOk(await new PubkyRingProfileTransport().resume(KEY))).toBeUndefined();
  expect(store.restore).not.toHaveBeenCalled();
  expect(store.remove.mock.calls).toEqual([["stored-grant"], ["other-expired"]]);
  expect([...store.saved.keys()]).toEqual(["other-grant"]);
  for (const handle of store.handles) expect(handle.free).toHaveBeenCalledOnce();
});

it("forgets expired grants when asked whether one is stored", async () => {
  const store = delegatedKeyStore({
    records: [storedGrant({ grantExpiresAt: Date.now() / 1000 - 1 })],
  });
  expect(await new PubkyRingProfileTransport().stored(KEY)).toBe(false);
  expect(store.saved.size).toBe(0);
});

it("clears delegated keys once the only stored grants have expired", async () => {
  const store = delegatedKeyStore({
    records: [storedGrant({ publicKey: OTHER, grantExpiresAt: Date.now() / 1000 - 60 })],
  });
  setup();
  const connection = await connect();
  // The expired record is forgotten first, so it no longer keeps the keys of abandoned flows.
  expect(store.remove).toHaveBeenCalledExactlyOnceWith("stored-grant");
  expect(store.clearAll).toHaveBeenCalledOnce();
  await connection.dispose();
  expect(store.clearAll).toHaveBeenCalledTimes(2);
});

it("still keeps the delegated keys when an expired record cannot be forgotten", async () => {
  const store = delegatedKeyStore({
    records: [storedGrant({ grantExpiresAt: Date.now() / 1000 - 60 })],
  });
  store.remove.mockRejectedValue(new Error("IndexedDB unavailable"));
  setup();
  const connection = await connect();
  expect(store.clearAll).not.toHaveBeenCalled();
  await connection.dispose();
  expect(store.clearAll).not.toHaveBeenCalled();
});

it("resumes nothing where the browser cannot store sessions", async () => {
  const store = delegatedKeyStore({ available: false, records: [storedGrant()] });
  const transport = new PubkyRingProfileTransport();
  expect(expectResultOk(await transport.resume(KEY))).toBeUndefined();
  expect(await transport.stored(KEY)).toBe(false);
  expect(store.list).not.toHaveBeenCalled();
  expect(store.restore).not.toHaveBeenCalled();
});

it("says nothing is stored when the store cannot be read", async () => {
  const store = delegatedKeyStore({ records: [storedGrant()] });
  store.list.mockRejectedValue(new Error("IndexedDB unavailable"));
  const transport = new PubkyRingProfileTransport();
  expect(await transport.stored(KEY)).toBe(false);
  expect(await transport.resume(KEY)).toMatchObject({ error: { code: "grant_failed" } });
});

it("forgets a stored grant that can no longer be restored, so the keychain is asked again", async () => {
  const store = delegatedKeyStore({ records: [storedGrant()] });
  store.restore.mockRejectedValueOnce(
    Object.assign(new Error("401 Unauthorized"), {
      name: "RequestError",
      data: { statusCode: 401 },
    }),
  );
  expect(expectResultOk(await new PubkyRingProfileTransport().resume(KEY))).toBeUndefined();
  expect(store.remove).toHaveBeenCalledExactlyOnceWith("stored-grant");
  expect(store.saved.size).toBe(0);
});

it.each([
  ["another identity", OTHER, PROFILE_CAPABILITIES],
  ["broader capabilities", KEY, ["/:rw"]],
])(
  "forgets a restored session for %s without using or revoking it",
  async (_case, publicKey, capabilities) => {
    const store = delegatedKeyStore({ records: [storedGrant()] });
    store.restore.mockImplementationOnce(async () => {
      const session = fakeSession(publicKey, capabilities);
      store.restored.push(session);
      return session as unknown as Session;
    });
    expect(expectResultOk(await new PubkyRingProfileTransport().resume(KEY))).toBeUndefined();
    expect(store.remove).toHaveBeenCalledExactlyOnceWith("stored-grant");
    const [session] = store.restored;
    expect(session!.free).toHaveBeenCalledOnce();
    expect(session!.signout).not.toHaveBeenCalled();
    expect(session!.storage.putJson).not.toHaveBeenCalled();
  },
);

it("revokes every stored grant of an identity on disconnect and forgets it, keeping others", async () => {
  const store = delegatedKeyStore({
    records: [
      storedGrant(),
      // Too close to expiry to resume, but still valid on the homeserver: revoked as well.
      storedGrant({ id: "expiring-grant", grantExpiresAt: Date.now() / 1000 + 30 }),
      storedGrant({ id: "other-grant", publicKey: OTHER }),
    ],
  });
  const transport = new PubkyRingProfileTransport();
  expectResultOk(await transport.disconnect(KEY));
  expect(store.restore.mock.calls).toEqual([["stored-grant"], ["expiring-grant"]]);
  expect(store.restored).toHaveLength(2);
  for (const session of store.restored) {
    expect(session.signout).toHaveBeenCalledOnce();
    expect(session.free).toHaveBeenCalledOnce();
  }
  expect(store.remove.mock.calls).toEqual([["stored-grant"], ["expiring-grant"]]);
  expect([...store.saved.keys()]).toEqual(["other-grant"]);
  expect(await transport.stored(KEY)).toBe(false);
  expect(await transport.stored(OTHER)).toBe(true);
  for (const handle of store.handles) expect(handle.free).toHaveBeenCalledOnce();
});

it("forgets a stored grant on disconnect even when it can no longer be restored", async () => {
  const store = delegatedKeyStore({ records: [storedGrant()] });
  store.restore.mockRejectedValueOnce(new Error("revoked"));
  expectResultOk(await new PubkyRingProfileTransport().disconnect(KEY));
  expect(store.remove).toHaveBeenCalledExactlyOnceWith("stored-grant");
  expect(store.saved.size).toBe(0);
});

it("reports a disconnect that could not forget the revoked grant", async () => {
  const store = delegatedKeyStore({ records: [storedGrant()] });
  store.remove.mockRejectedValue(new Error("IndexedDB unavailable"));
  expect(await new PubkyRingProfileTransport().disconnect(KEY)).toMatchObject({
    error: { code: "grant_failed" },
  });
  // Revoked once, and the record is not tried again.
  expect(store.restore).toHaveBeenCalledOnce();
  expect(store.restored[0]!.signout).toHaveBeenCalledOnce();
  expect(store.remove).toHaveBeenCalledOnce();
});

it("reports a disconnect whose record comes back after it was removed", async () => {
  const store = delegatedKeyStore({ records: [storedGrant()] });
  // The store says it removed the record, yet still lists it.
  store.remove.mockResolvedValue(undefined);
  expect(await new PubkyRingProfileTransport().disconnect(KEY)).toMatchObject({
    error: { code: "grant_failed" },
  });
  expect(store.restore).toHaveBeenCalledOnce();
  expect(store.remove).toHaveBeenCalledOnce();
});

it("disconnects at once when no grant of the identity is stored", async () => {
  const store = delegatedKeyStore({ records: [storedGrant({ publicKey: OTHER })] });
  expectResultOk(await new PubkyRingProfileTransport().disconnect(KEY));
  expect(store.restore).not.toHaveBeenCalled();
  expect(store.remove).not.toHaveBeenCalled();
});

it("reports a disconnect whose store cannot be read", async () => {
  const store = delegatedKeyStore({ records: [storedGrant()] });
  store.list.mockRejectedValue(new Error("IndexedDB unavailable"));
  expect(await new PubkyRingProfileTransport().disconnect(KEY)).toMatchObject({
    error: { code: "grant_failed" },
  });
  expect(store.free).toHaveBeenCalledOnce();
});

it.each([401, 403])(
  "forgets a stored grant the homeserver refuses with %i, and asks again next time",
  async (statusCode) => {
    const store = delegatedKeyStore();
    const { approved, flow } = setup();
    const connection = await connect();
    flow.tryPollOnce.mockResolvedValue(approved as unknown as Session);
    await connection.poll();
    await connection.keep();
    expect(store.saved.size).toBe(1);
    approved.storage.putJson.mockRejectedValueOnce({ name: "RequestError", data: { statusCode } });
    expect(await connection.publish(KEY, WRITES)).toMatchObject({
      error: { code: "publish_unauthorized" },
    });
    expect(store.remove).toHaveBeenCalledExactlyOnceWith("saved-1");
    expect(store.saved.size).toBe(0);
    await connection.dispose();
  },
);

it("forgets a resumed grant the homeserver refuses", async () => {
  const store = delegatedKeyStore({ records: [storedGrant()] });
  const grant = expectResultOk(await new PubkyRingProfileTransport().resume(KEY))!;
  store.restored[0]!.storage.putJson.mockRejectedValueOnce({
    name: "RequestError",
    data: { statusCode: 401 },
  });
  expect(await grant.publish(KEY, WRITES)).toMatchObject({
    error: { code: "publish_unauthorized" },
  });
  expect(store.remove).toHaveBeenCalledExactlyOnceWith("stored-grant");
  expect(store.saved.size).toBe(0);
  await grant.dispose();
});

it("keeps a stored grant through a failure the homeserver did not refuse", async () => {
  const store = delegatedKeyStore({ records: [storedGrant()] });
  const grant = expectResultOk(await new PubkyRingProfileTransport().resume(KEY))!;
  store.restored[0]!.storage.putJson.mockRejectedValueOnce({
    name: "RequestError",
    data: { statusCode: 500 },
  });
  expect(await grant.publish(KEY, WRITES)).toMatchObject({ error: { code: "publish_failed" } });
  expect(store.remove).not.toHaveBeenCalled();
  expect(store.saved.has("stored-grant")).toBe(true);
  await grant.dispose();
  expect(store.restored[0]!.signout).not.toHaveBeenCalled();
});

it("clears delegated keys only while no grant is stored", async () => {
  const store = delegatedKeyStore({ records: [storedGrant({ publicKey: OTHER })] });
  setup();
  const held = await connect();
  await held.dispose();
  // Another identity's stored grant signs with a key among them.
  expect(store.clearAll).not.toHaveBeenCalled();
  store.saved.clear();
  const next = await connect();
  expect(store.clearAll).toHaveBeenCalledOnce();
  await next.dispose();
  expect(store.clearAll).toHaveBeenCalledTimes(2);
});
