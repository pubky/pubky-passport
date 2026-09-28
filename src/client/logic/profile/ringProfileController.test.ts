/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Result } from "better-result";
import { RingProfileController } from "./RingProfileController";
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
function setup() {
  const repository = new LocalStorageIdentityRepository();
  const connection = {
    authorizationUrl: () => URL,
    poll: vi.fn(async (): Promise<PubkyProfileGrantResult<string | undefined>> =>
      Result.ok(undefined),
    ),
    publish: vi.fn(async (): Promise<PubkyProfileWriteResult> => Result.ok()),
    dispose: vi.fn(async () => undefined),
  };
  let now = 0;
  const start = vi.fn<Pick<PubkyRingProfileTransport, "start">["start"]>(async () =>
    Result.ok(connection as unknown as RingProfileGrant),
  );
  const controller = new RingProfileController(RELAY, repository, { start }, () => now);
  return {
    repository,
    connection,
    controller,
    start,
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
  expect(start).toHaveBeenCalledExactlyOnceWith(RELAY);
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
  });
  // Nothing is saved or usable for publishing before the confirmation.
  expect(expectResultOk(repository.list()).identities).toEqual([]);
  expect(controller.isConnected(OTHER)).toBe(false);
  expect(await controller.save(OTHER, profile)).toMatchObject({ error: { code: "disconnected" } });
  expect(expectResultOk(await controller.poll())).toEqual({
    status: "approved",
    publicKeyZ32: OTHER,
  });
  expect(connection.poll).toHaveBeenCalledOnce();

  expect(expectResultOk(controller.confirm())).toMatchObject({
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
  expectResultError(controller.confirm(), { code: "cancelled" });
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
  expect(controller.confirm()).toMatchObject({ error: { code: "storage_failed" } });
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
