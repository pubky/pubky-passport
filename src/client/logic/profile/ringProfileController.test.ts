/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import { RingProfileController } from "./RingProfileController";
import type { ProfileController } from "./ProfileController";
import { LocalStorageIdentityRepository } from "../local-identity/LocalStorageIdentityRepository";
import { PUBKY_SECRET_KEY_FORMAT } from "../pubky/pubkyIdentityKey";
import type {
  PubkyProfileGrantResult,
  PubkyProfileWriteResult,
  PubkyRingProfileTransport,
  RingProfileGrant,
} from "../pubky/PubkySdkAdapter";
import { PROFILE_PATH } from "./profile";
import { expectResultOk, expectResultError } from "@test-utils/resultAssertions";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const OTHER = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const URL = "pubkyauth://signin?secret=PROFILE-REQUEST-SECRET";
const RELAY = "https://relay.passport.example/inbox";
const profile = { name: "Satoshi" };
type RingProfileControllerProfiles = Pick<ProfileController, "hasProfile">;
function setup() {
  const repository = new LocalStorageIdentityRepository();
  const connection = {
    authorizationUrl: () => URL,
    poll: vi.fn(async (): Promise<PubkyProfileGrantResult<string | undefined>> =>
      Result.ok(undefined),
    ),
    publish: vi.fn(async (): Promise<PubkyProfileWriteResult> => Result.ok()),
    dispose: vi.fn(async () => undefined),
    keep: vi.fn(async () => undefined),
  };
  let now = 0;
  const start = vi.fn<Pick<PubkyRingProfileTransport, "start">["start"]>(async () =>
    Result.ok(connection as unknown as RingProfileGrant),
  );
  const hasProfile = vi.fn<RingProfileControllerProfiles["hasProfile"]>(async () =>
    Result.ok(false),
  );
  // No profile grant is stored in this browser unless a test says so.
  const resume = vi.fn<PubkyRingProfileTransport["resume"]>(async () => Result.ok(undefined));
  const stored = vi.fn<PubkyRingProfileTransport["stored"]>(async () => false);
  const disconnect = vi.fn<PubkyRingProfileTransport["disconnect"]>(async () => Result.ok());
  const controller = new RingProfileController(
    RELAY,
    repository,
    { start, resume, stored, disconnect },
    () => now,
    { hasProfile },
  );
  return {
    repository,
    hasProfile,
    connection,
    controller,
    start,
    resume,
    stored,
    disconnect,
    expire: () => {
      now = 300_000;
    },
  };
}
async function connected(setupRequired = false) {
  const context = setup();
  await context.controller.start({ setupRequired });
  context.connection.poll.mockResolvedValue(Result.ok(KEY));
  expectResultOk(await context.controller.poll());
  return context;
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("only remembers a Ring identity after approval, with no key or request in persistent storage", async () => {
  const { controller, connection, repository, start } = setup();
  expectResultOk(await controller.start());
  expect(start).toHaveBeenCalledExactlyOnceWith(RELAY, "grant");
  expect(controller.authorizationUrl()).toBe(URL);
  expect(expectResultOk(await controller.poll())).toEqual({ status: "waiting" });
  expect(expectResultOk(repository.list()).identities).toEqual([]);
  connection.poll.mockResolvedValue(Result.ok(KEY));
  expect(expectResultOk(await controller.poll())).toMatchObject({
    status: "connected",
    identity: { keySource: "ring", publicIdentity: { publicKeyZ32: KEY } },
  });
  expect(controller.authorizationUrl()).toBeUndefined();
  const stored = localStorage.getItem(`pubky-passport/local-identities/v1/identity/${KEY}`)!;
  expect(JSON.parse(stored)).toEqual({ v: 1, publicKeyZ32: KEY, keySource: "ring" });
  expect(JSON.stringify(localStorage)).not.toContain("PROFILE-REQUEST-SECRET");
  expect(Result.isError(repository.read(KEY))).toBe(true);
  expect(expectResultOk(new LocalStorageIdentityRepository().list()).activePublicKeyZ32).toBe(KEY);
});

it("rejects approval by another identity without saving it", async () => {
  const { controller, connection, repository } = setup();
  await controller.start({ expectedKey: KEY });
  connection.poll.mockResolvedValue(Result.ok(OTHER));
  expectResultError(await controller.poll(), { code: "wrong_identity" });
  expect(expectResultOk(repository.list()).identities).toEqual([]);
  expect(connection.dispose).toHaveBeenCalledOnce();
});

it("reports a grant without every profile permission and closes it", async () => {
  const { controller, connection } = setup();
  await controller.start({ expectedKey: KEY });
  connection.poll.mockResolvedValue(Result.err({ code: "missing_capabilities" }));
  expect(await controller.poll()).toMatchObject({ error: { code: "missing_capabilities" } });
  expect(connection.dispose).toHaveBeenCalledOnce();
});

it("reports a request that could not be created before Ring was involved", async () => {
  const controller = new RingProfileController(RELAY, new LocalStorageIdentityRepository(), {
    start: async () => Result.err({ code: "grant_failed" }),
  });
  expect(await controller.start()).toMatchObject({ error: { code: "request_failed" } });
});

it.each([
  ["homeserver_unresolved", "homeserver_unresolved"],
  ["grant_rejected", "grant_rejected"],
  ["grant_failed", "connection_failed"],
  ["grant_busy", "connection_failed"],
] as const)("reports a %s poll failure as %s and closes the connection", async (failure, code) => {
  const { controller, connection, repository } = setup();
  await controller.start();
  connection.poll.mockResolvedValue(Result.err({ code: failure }));
  expect(await controller.poll()).toMatchObject({ error: { code } });
  expect(connection.dispose).toHaveBeenCalledOnce();
  expect(expectResultOk(repository.list()).identities).toEqual([]);
});

it("expires pending requests without removing identities already stored", async () => {
  const { controller, connection, repository, expire } = setup();
  repository.saveExternal(OTHER);
  await controller.start();
  expire();
  expect(controller.authorizationUrl()).toBeUndefined();
  expectResultError(await controller.poll(), { code: "expired" });
  expect(connection.poll).not.toHaveBeenCalled();
  expect(expectResultOk(repository.list()).identities).toHaveLength(1);
});

it("retries saving an approved identity without asking Ring again", async () => {
  const { controller, connection, repository, expire } = setup();
  await controller.start();
  connection.poll.mockResolvedValue(Result.ok(KEY));
  const saveExternal = vi
    .spyOn(repository, "saveExternal")
    .mockReturnValueOnce(Result.err({ code: "storage_unavailable" }));
  expect(await controller.poll()).toMatchObject({ error: { code: "storage_failed" } });
  expect(connection.dispose).not.toHaveBeenCalled();
  expire(); // Ring already approved, so the request deadline no longer applies.
  expect(expectResultOk(await controller.poll())).toMatchObject({
    identity: { publicIdentity: { publicKeyZ32: KEY } },
  });
  expect(connection.poll).toHaveBeenCalledOnce();
  expect(saveExternal).toHaveBeenCalledTimes(2);
  expect(controller.isConnected(KEY)).toBe(true);
});

it("flags setup only for a pubky without a published profile, and says whether it has one", async () => {
  const { controller, connection, repository, hasProfile } = setup();
  await controller.start({ setupRequired: true, confirmIdentity: true });
  connection.poll.mockResolvedValue(Result.ok(KEY));
  expect(expectResultOk(await controller.poll())).toEqual({
    status: "approved",
    publicKeyZ32: KEY,
    hasProfile: "none",
  });
  expect(hasProfile).toHaveBeenCalledExactlyOnceWith(KEY);
  expect(expectResultOk(await controller.confirm()).profileSetupRequired).toBe(true);
  expect(expectResultOk(repository.list()).identities[0]?.profileSetupRequired).toBe(true);
});

it("never flags setup for an approving pubky that already has a published profile", async () => {
  const context = setup();
  context.hasProfile.mockResolvedValue(Result.ok(true));
  await context.controller.start({ setupRequired: true, confirmIdentity: true });
  context.connection.poll.mockResolvedValue(Result.ok(KEY));
  expect(expectResultOk(await context.controller.poll())).toEqual({
    status: "approved",
    publicKeyZ32: KEY,
    hasProfile: "published",
  });
  expect(expectResultOk(await context.controller.confirm())).not.toHaveProperty(
    "profileSetupRequired",
  );
  const stored = localStorage.getItem(`pubky-passport/local-identities/v1/identity/${KEY}`)!;
  expect(JSON.parse(stored)).toEqual({ v: 1, publicKeyZ32: KEY, keySource: "ring" });
});

it.each([
  ["still fails", Result.err({ code: "load_failed" as const }), true],
  ["finds no profile", Result.ok(false), true],
  ["finds a published profile", Result.ok(true), false],
] as const)(
  "reads an unknown profile again on confirmation and flags setup unless that read %s",
  async (_case, reread, flagged) => {
    const context = setup();
    context.hasProfile.mockResolvedValueOnce(Result.err({ code: "load_failed" }));
    context.hasProfile.mockResolvedValueOnce(reread);
    await context.controller.start({ setupRequired: true, confirmIdentity: true });
    context.connection.poll.mockResolvedValue(Result.ok(KEY));
    expect(expectResultOk(await context.controller.poll())).toEqual({
      status: "approved",
      publicKeyZ32: KEY,
      hasProfile: "unknown",
    });
    const identity = expectResultOk(await context.controller.confirm());
    expect(context.hasProfile).toHaveBeenCalledTimes(2);
    expect(identity.profileSetupRequired === true).toBe(flagged);
    expect(
      expectResultOk(context.repository.list()).identities[0]?.profileSetupRequired === true,
    ).toBe(flagged);
  },
);

it("completes a stale setup flag once the saved Ring identity's profile is live", async () => {
  const { controller, connection, repository, hasProfile } = setup();
  expectResultOk(repository.saveExternal(KEY, true));
  hasProfile.mockResolvedValue(Result.ok(true));
  await controller.start({ expectedKey: KEY, setupRequired: true });
  connection.poll.mockResolvedValue(Result.ok(KEY));
  const progress = expectResultOk(await controller.poll());
  expect(progress).toMatchObject({ status: "connected" });
  expect(progress.status === "connected" && progress.identity).not.toHaveProperty(
    "profileSetupRequired",
  );
  expect(expectResultOk(repository.list()).identities[0]).not.toHaveProperty(
    "profileSetupRequired",
  );
});

it("does not read the profile when no setup was asked for", async () => {
  const { hasProfile } = await connected();
  expect(hasProfile).not.toHaveBeenCalled();
});

it("does not replace local key material when the same identity connects through Ring", () => {
  const { repository } = setup();
  const secret = { format: PUBKY_SECRET_KEY_FORMAT, bytes: new Uint8Array(32).fill(1) } as const;
  expectResultOk(repository.save({ publicIdentity: { publicKeyZ32: KEY } }, secret));
  expect(expectResultOk(repository.saveExternal(KEY)).keySource).toBeUndefined();
  expect(expectResultOk(repository.read(KEY)).secretKey.bytes).toEqual(secret.bytes);
});

it("keeps profile setup pending until publication succeeds, and requires a new grant after reload", async () => {
  const { controller, connection, repository } = await connected(true);
  connection.publish.mockResolvedValueOnce(Result.err({ code: "publish_failed" }));
  expect(await controller.save(KEY, profile)).toMatchObject({ error: { code: "save_failed" } });
  expect(expectResultOk(repository.list()).identities[0]?.profileSetupRequired).toBe(true);
  expect(expectResultOk(await controller.save(KEY, { name: " Satoshi " }))).toEqual(profile);
  expect(connection.publish).toHaveBeenLastCalledWith(KEY, [
    { kind: "json", path: PROFILE_PATH, json: profile },
  ]);
  expect(expectResultOk(repository.list()).identities[0]?.profileSetupRequired).toBeUndefined();
  expect(await new RingProfileController(RELAY, repository).save(KEY, profile)).toMatchObject({
    error: { code: "disconnected" },
  });
});

it("validates the profile before using the grant", async () => {
  const { controller, connection } = await connected();
  expect(await controller.save(KEY, { name: "x" })).toMatchObject({
    error: { code: "invalid_profile" },
  });
  expect(connection.publish).not.toHaveBeenCalled();
});

it("closes a revoked grant so the next save asks to reconnect", async () => {
  const { controller, connection } = await connected();
  connection.publish.mockResolvedValueOnce(Result.err({ code: "publish_unauthorized" }));
  expect(await controller.save(KEY, profile)).toMatchObject({ error: { code: "disconnected" } });
  expect(connection.dispose).toHaveBeenCalledOnce();
  expect(controller.isConnected(KEY)).toBe(false);
  expect(await controller.save(KEY, profile)).toMatchObject({ error: { code: "disconnected" } });
});

it("finishes setup for a profile published while the connection closed", async () => {
  const { controller, connection, repository } = await connected(true);
  let publish!: () => void;
  connection.publish.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        publish = () => resolve(Result.ok());
      }),
  );
  const saving = controller.save(KEY, profile);
  await vi.waitFor(() => expect(connection.publish).toHaveBeenCalledOnce());
  controller.dispose();
  publish();
  expect(await saving).toMatchObject({ error: { code: "cancelled" } });
  expect(expectResultOk(repository.list()).identities[0]?.profileSetupRequired).toBeUndefined();
});

it("discards an approval arriving after navigation cancels the connection", async () => {
  const { controller, connection, repository } = setup();
  let approve!: (key: string) => void;
  connection.poll.mockImplementation(
    () =>
      new Promise((resolve) => {
        approve = (key) => resolve(Result.ok(key));
      }),
  );
  await controller.start();
  const poll = controller.poll();
  controller.dispose();
  approve(KEY);
  expectResultError(await poll, { code: "cancelled" });
  expect(expectResultOk(repository.list()).identities).toEqual([]);
});

it("does not publish after the identity is removed from this browser", async () => {
  const { controller, connection, repository } = await connected();
  repository.remove(KEY);
  expect(await controller.save(KEY, profile)).toMatchObject({
    error: { code: "identity_unavailable" },
  });
  expect(connection.publish).not.toHaveBeenCalled();
});

it("holds the pubky Ring approved after a signup until the person confirms it", async () => {
  const { controller, connection, repository } = setup();
  await controller.start({ setupRequired: true, confirmIdentity: true });
  connection.poll.mockResolvedValue(Result.ok(OTHER));
  expect(expectResultOk(await controller.poll())).toEqual({
    status: "approved",
    publicKeyZ32: OTHER,
    hasProfile: "none",
  });
  // Nothing is saved or usable for publishing before the confirmation.
  expect(expectResultOk(repository.list()).identities).toEqual([]);
  expect(controller.isConnected(OTHER)).toBe(false);
  expect(await controller.save(OTHER, profile)).toMatchObject({ error: { code: "disconnected" } });
  expect(expectResultOk(await controller.poll())).toEqual({
    status: "approved",
    publicKeyZ32: OTHER,
    hasProfile: "none",
  });
  expect(connection.poll).toHaveBeenCalledOnce();

  expect(expectResultOk(await controller.confirm())).toMatchObject({
    keySource: "ring",
    profileSetupRequired: true,
    publicIdentity: { publicKeyZ32: OTHER },
  });
  expect(controller.isConnected(OTHER)).toBe(true);
  expect(expectResultOk(await controller.save(OTHER, profile))).toEqual(profile);
});

it("discards an unconfirmed approval without saving it", async () => {
  const { controller, connection, repository, start } = setup();
  await controller.start({ setupRequired: true, confirmIdentity: true });
  connection.poll.mockResolvedValue(Result.ok(OTHER));
  await controller.poll();
  await controller.start({ setupRequired: true, confirmIdentity: true });
  expect(connection.dispose).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledTimes(2);
  expect(expectResultOk(repository.list()).identities).toEqual([]);
  controller.dispose();
  expectResultError(await controller.confirm(), { code: "cancelled" });
  expect(expectResultOk(repository.list()).identities).toEqual([]);
});

it("keeps an approved pubky for a retry when saving it after confirmation fails", async () => {
  const { controller, connection, repository } = setup();
  await controller.start({ setupRequired: true, confirmIdentity: true });
  connection.poll.mockResolvedValue(Result.ok(KEY));
  await controller.poll();
  vi.spyOn(repository, "saveExternal").mockReturnValueOnce(
    Result.err({ code: "storage_unavailable" }),
  );
  expect(await controller.confirm()).toMatchObject({ error: { code: "storage_failed" } });
  // The confirmation stands; retrying saves without asking again.
  expect(expectResultOk(await controller.poll())).toMatchObject({ status: "connected" });
  expect(connection.poll).toHaveBeenCalledOnce();
});

it("needs no confirmation when the expected identity is already known", async () => {
  const { controller, connection } = setup();
  await controller.start({ expectedKey: KEY, confirmIdentity: true });
  connection.poll.mockResolvedValue(Result.ok(KEY));
  expect(expectResultOk(await controller.poll())).toMatchObject({ status: "connected" });
});

it("asks the legacy way for Pubky Ring older than 2.0 when the classic QR is on", async () => {
  const { controller, start } = setup();
  expectResultOk(await controller.start({ method: "cookie" }));
  expect(start).toHaveBeenCalledExactlyOnceWith(RELAY, "cookie");
  controller.dispose();
});

describe("the profile grant stored in this browser", () => {
  /** A stored grant that the transport connects again for `KEY`. */
  function storedGrant() {
    const context = setup();
    context.resume.mockResolvedValue(Result.ok(context.connection as unknown as RingProfileGrant));
    return context;
  }

  it("connects a saved Ring identity again without asking the keychain, and saves through it", async () => {
    const { controller, connection, repository, resume, start, hasProfile, expire } = storedGrant();
    const identity = expectResultOk(await controller.resume({ expectedKey: KEY }));
    expect(identity).toEqual({ publicIdentity: { publicKeyZ32: KEY }, keySource: "ring" });
    expect(resume).toHaveBeenCalledExactlyOnceWith(KEY);
    expect(start).not.toHaveBeenCalled();
    expect(connection.poll).not.toHaveBeenCalled();
    expect(hasProfile).not.toHaveBeenCalled();
    // Saved as after an approval, and connected for that identity only, with nothing to show.
    expect(expectResultOk(repository.list())).toEqual({
      activePublicKeyZ32: KEY,
      identities: [identity],
    });
    expect(controller.isConnected(KEY)).toBe(true);
    expect(controller.isConnected(OTHER)).toBe(false);
    expect(controller.authorizationUrl()).toBeUndefined();
    expect(expectResultOk(await controller.poll())).toMatchObject({ status: "connected" });
    // A stored grant has no request deadline.
    expire();
    expect(expectResultOk(await controller.save(KEY, profile))).toEqual(profile);
    expect(connection.publish).toHaveBeenCalledExactlyOnceWith(KEY, [
      { kind: "json", path: PROFILE_PATH, json: profile },
    ]);
    expect(await controller.save(OTHER, profile)).toMatchObject({
      error: { code: "disconnected" },
    });
    expect(connection.dispose).not.toHaveBeenCalled();
  });

  it.each([
    ["has no published profile", Result.ok(false), true],
    ["has a published profile", Result.ok(true), false],
    ["cannot be read", Result.err({ code: "load_failed" as const }), true],
  ] as const)(
    "reads the profile first when setup is asked for, and flags it unless the pubky %s",
    async (_case, published, flagged) => {
      const { controller, repository, hasProfile } = storedGrant();
      hasProfile.mockResolvedValue(published);
      const identity = expectResultOk(
        await controller.resume({ expectedKey: KEY, setupRequired: true }),
      );
      expect(hasProfile).toHaveBeenCalledExactlyOnceWith(KEY);
      expect(identity?.profileSetupRequired === true).toBe(flagged);
      expect(expectResultOk(repository.list()).identities[0]?.profileSetupRequired === true).toBe(
        flagged,
      );
    },
  );

  it("completes a stale setup flag once the resumed identity's profile is live", async () => {
    const { controller, repository, hasProfile } = storedGrant();
    expectResultOk(repository.saveExternal(KEY, true));
    hasProfile.mockResolvedValue(Result.ok(true));
    const identity = expectResultOk(
      await controller.resume({ expectedKey: KEY, setupRequired: true }),
    );
    expect(identity).not.toHaveProperty("profileSetupRequired");
    expect(expectResultOk(repository.list()).identities[0]).not.toHaveProperty(
      "profileSetupRequired",
    );
  });

  it("says when no grant is stored, so the keychain is asked, and saves nothing", async () => {
    const { controller, repository, resume, start } = setup();
    expect(expectResultOk(await controller.resume({ expectedKey: KEY }))).toBeUndefined();
    expect(resume).toHaveBeenCalledExactlyOnceWith(KEY);
    // A store that cannot be read counts as nothing stored.
    resume.mockResolvedValueOnce(Result.err({ code: "grant_failed" }));
    expect(expectResultOk(await controller.resume({ expectedKey: KEY }))).toBeUndefined();
    expect(controller.isConnected(KEY)).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(expectResultOk(repository.list()).identities).toEqual([]);
  });

  it.each([
    ["no identity is known", undefined],
    ["the key is not a pubky", "not-a-pubky"],
  ])("looks for no stored grant when %s", async (_case, expectedKey) => {
    const { controller, resume } = storedGrant();
    expect(expectResultOk(await controller.resume({ expectedKey }))).toBeUndefined();
    expect(resume).not.toHaveBeenCalled();
    expect(controller.isConnected()).toBe(false);
  });

  it("resumes nothing with a transport that stores no grant", async () => {
    const controller = new RingProfileController(RELAY, new LocalStorageIdentityRepository(), {
      start: async () => Result.err({ code: "grant_failed" }),
    });
    expect(expectResultOk(await controller.resume({ expectedKey: KEY }))).toBeUndefined();
    expect(await controller.hasStoredConnection(KEY)).toBe(false);
    expectResultOk(await controller.disconnect(KEY));
  });

  it("closes a grant resumed after the connection was cancelled, without saving it", async () => {
    const { controller, connection, repository, resume } = setup();
    let restore!: () => void;
    resume.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          restore = () => resolve(Result.ok(connection as unknown as RingProfileGrant));
        }),
    );
    const resuming = controller.resume({ expectedKey: KEY });
    await vi.waitFor(() => expect(resume).toHaveBeenCalledOnce());
    controller.dispose();
    restore();
    expectResultError(await resuming, { code: "cancelled" });
    expect(connection.dispose).toHaveBeenCalledOnce();
    expect(controller.isConnected(KEY)).toBe(false);
    expect(expectResultOk(repository.list()).identities).toEqual([]);
  });

  it("closes a resumed grant cancelled while its profile is read, without saving it", async () => {
    const { controller, connection, repository, hasProfile } = storedGrant();
    let read!: () => void;
    hasProfile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          read = () => resolve(Result.ok(false));
        }),
    );
    const resuming = controller.resume({ expectedKey: KEY, setupRequired: true });
    await vi.waitFor(() => expect(hasProfile).toHaveBeenCalledOnce());
    controller.dispose();
    read();
    expectResultError(await resuming, { code: "cancelled" });
    expect(connection.dispose).toHaveBeenCalledOnce();
    expect(controller.isConnected(KEY)).toBe(false);
    expect(expectResultOk(repository.list()).identities).toEqual([]);
  });

  it("closes a resumed grant whose identity could not be saved", async () => {
    const { controller, connection, repository } = storedGrant();
    vi.spyOn(repository, "saveExternal").mockReturnValueOnce(
      Result.err({ code: "storage_unavailable" }),
    );
    expect(await controller.resume({ expectedKey: KEY })).toMatchObject({
      error: { code: "storage_failed" },
    });
    expect(connection.dispose).toHaveBeenCalledOnce();
    expect(controller.isConnected(KEY)).toBe(false);
  });

  it("closes the connection open before a resume", async () => {
    const { controller, connection, resume } = await connected();
    expect(expectResultOk(await controller.resume({ expectedKey: KEY }))).toBeUndefined();
    expect(connection.dispose).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    expect(controller.isConnected(KEY)).toBe(false);
  });

  it("says whether a grant is stored for an identity", async () => {
    const { controller, stored } = setup();
    expect(await controller.hasStoredConnection(KEY)).toBe(false);
    stored.mockResolvedValueOnce(true);
    expect(await controller.hasStoredConnection(KEY)).toBe(true);
    expect(stored).toHaveBeenLastCalledWith(KEY);
    stored.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
    expect(await controller.hasStoredConnection(KEY)).toBe(false);
  });

  it("ends the identity's open connection before revoking its stored grant", async () => {
    const { controller, connection, disconnect } = await connected();
    expectResultOk(await controller.disconnect(KEY));
    expect(connection.dispose).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledExactlyOnceWith(KEY);
    expect(connection.dispose.mock.invocationCallOrder[0]).toBeLessThan(
      disconnect.mock.invocationCallOrder[0]!,
    );
    expect(controller.isConnected(KEY)).toBe(false);
    expect(await controller.save(KEY, profile)).toMatchObject({ error: { code: "disconnected" } });
  });

  it("ends the pending request for the identity it disconnects", async () => {
    const { controller, connection, disconnect } = setup();
    await controller.start({ expectedKey: KEY });
    expectResultOk(await controller.disconnect(KEY));
    expect(connection.dispose).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledExactlyOnceWith(KEY);
  });

  it("keeps another identity's connection when disconnecting one", async () => {
    const { controller, connection, disconnect } = await connected();
    expectResultOk(await controller.disconnect(OTHER));
    expect(disconnect).toHaveBeenCalledExactlyOnceWith(OTHER);
    expect(connection.dispose).not.toHaveBeenCalled();
    expect(controller.isConnected(KEY)).toBe(true);
  });

  it("reports a disconnect that failed", async () => {
    const { controller, disconnect } = setup();
    disconnect.mockResolvedValueOnce(Result.err({ code: "grant_failed" }));
    expect(await controller.disconnect(KEY)).toMatchObject({
      error: { code: "connection_failed", cause: { code: "grant_failed" } },
    });
  });
});

describe("keeping an approved grant for later edits", () => {
  it("keeps the grant once the expected identity is saved and connected", async () => {
    const { controller, connection, repository } = setup();
    const saveExternal = vi.spyOn(repository, "saveExternal");
    await controller.start({ expectedKey: KEY });
    expectResultOk(await controller.poll());
    expect(connection.keep).not.toHaveBeenCalled();
    connection.poll.mockResolvedValue(Result.ok(KEY));
    expect(expectResultOk(await controller.poll())).toMatchObject({ status: "connected" });
    expect(connection.keep).toHaveBeenCalledOnce();
    expect(saveExternal.mock.invocationCallOrder[0]).toBeLessThan(
      connection.keep.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps the grant of a pubky added from Sign in once it is saved", async () => {
    const { connection } = await connected();
    expect(connection.keep).toHaveBeenCalledOnce();
  });

  it("never keeps a grant another identity approved", async () => {
    const { controller, connection } = setup();
    await controller.start({ expectedKey: KEY });
    connection.poll.mockResolvedValue(Result.ok(OTHER));
    expectResultError(await controller.poll(), { code: "wrong_identity" });
    expect(connection.keep).not.toHaveBeenCalled();
    expect(connection.dispose).toHaveBeenCalledOnce();
  });

  it("keeps a Ring signup's grant only once the person confirms its pubky", async () => {
    const { controller, connection, repository } = setup();
    await controller.start({ setupRequired: true, confirmIdentity: true });
    connection.poll.mockResolvedValue(Result.ok(OTHER));
    expect(expectResultOk(await controller.poll())).toMatchObject({ status: "approved" });
    expect(expectResultOk(await controller.poll())).toMatchObject({ status: "approved" });
    expect(connection.keep).not.toHaveBeenCalled();
    const saveExternal = vi.spyOn(repository, "saveExternal");
    expectResultOk(await controller.confirm());
    expect(connection.keep).toHaveBeenCalledOnce();
    expect(saveExternal.mock.invocationCallOrder[0]).toBeLessThan(
      connection.keep.mock.invocationCallOrder[0]!,
    );
  });

  it("never keeps a Ring signup's grant the person did not confirm", async () => {
    const { controller, connection } = setup();
    await controller.start({ setupRequired: true, confirmIdentity: true });
    connection.poll.mockResolvedValue(Result.ok(OTHER));
    await controller.poll();
    // No, choose again in the keychain: a new request replaces the approved one.
    await controller.start({ setupRequired: true, confirmIdentity: true });
    expect(connection.dispose).toHaveBeenCalledOnce();
    expect(connection.keep).not.toHaveBeenCalled();
  });

  it("keeps a confirmed grant only once its identity is saved, retried without Ring", async () => {
    const { controller, connection, repository } = setup();
    await controller.start({ setupRequired: true, confirmIdentity: true });
    connection.poll.mockResolvedValue(Result.ok(KEY));
    await controller.poll();
    vi.spyOn(repository, "saveExternal").mockReturnValueOnce(
      Result.err({ code: "storage_unavailable" }),
    );
    expect(await controller.confirm()).toMatchObject({ error: { code: "storage_failed" } });
    expect(connection.keep).not.toHaveBeenCalled();
    expect(expectResultOk(await controller.poll())).toMatchObject({ status: "connected" });
    expect(connection.keep).toHaveBeenCalledOnce();
  });

  it("keeps an approved grant only once saving its identity succeeds on a retry", async () => {
    const { controller, connection, repository } = setup();
    await controller.start({ expectedKey: KEY });
    connection.poll.mockResolvedValue(Result.ok(KEY));
    vi.spyOn(repository, "saveExternal").mockReturnValueOnce(
      Result.err({ code: "storage_unavailable" }),
    );
    expect(await controller.poll()).toMatchObject({ error: { code: "storage_failed" } });
    expect(connection.keep).not.toHaveBeenCalled();
    expect(expectResultOk(await controller.poll())).toMatchObject({ status: "connected" });
    expect(connection.keep).toHaveBeenCalledOnce();
  });

  it("keeps nothing while Ring has not approved", async () => {
    const { controller, connection } = setup();
    await controller.start({ expectedKey: KEY });
    expect(expectResultOk(await controller.poll())).toEqual({ status: "waiting" });
    connection.poll.mockResolvedValue(Result.err({ code: "grant_failed" }));
    await controller.poll();
    expect(connection.keep).not.toHaveBeenCalled();
  });
});
