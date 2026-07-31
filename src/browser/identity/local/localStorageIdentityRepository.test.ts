/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../../test-utils/fakes/memoryStorage";
import { expectResultError, expectResultOk } from "../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../libs/logger/logger";
import { PUBKY_SECRET_KEY_FORMAT } from "../../pubky/pubkyIdentityKey";
import { LocalStorageIdentityRepository } from "./localStorageIdentityRepository";

const FIRST_IDENTITY = { publicKeyZ32: "firstidentity111111111111111111111111111111111111111111", publicKeyDisplay: "pubkyfirstidentity111111111111111111111111111111111111111111" };
const SECOND_IDENTITY = { publicKeyZ32: "secondidentity11111111111111111111111111111111111111111", publicKeyDisplay: "pubkysecondidentity11111111111111111111111111111111111111111" };

describe("LocalStorageIdentityRepository", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists identities and selects the latest one", () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageIdentityRepository(storage);
    const first = save(repository, FIRST_IDENTITY, 1);
    const second = save(repository, SECOND_IDENTITY, 2);

    const reloadedRepository = new LocalStorageIdentityRepository(storage);
    expect(expectResultOk(reloadedRepository.list())).toEqual({ activeIdentityId: second.id, identities: [first, second] });
    expect(JSON.parse(storage.getItem("pubky-passport/local-identities/v1")!)).toEqual({
      v: 1,
      activeIdentityId: second.id,
      identities: [
        { ...first, secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE" },
        { ...second, secretKey: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI" },
      ],
    });
    expect(expectResultOk(reloadedRepository.readActive())).toEqual({
      identity: second,
      secretKey: { bytes: new Uint8Array(32).fill(2), format: PUBKY_SECRET_KEY_FORMAT },
    });
  });

  it("rejects malformed persisted values", () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const storage = new MemoryStorage();
    storage.setItem("pubky-passport/local-identities/v1", '{"v":1,"identities":"secret"}');
    expectResultError(new LocalStorageIdentityRepository(storage).list(), { code: "invalid_store" });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("identity.local_store.failed", {
      operation: "read",
      code: "invalid_store",
    });
  });

  it("logs storage exceptions without exposing persisted contents", () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const storage = new MemoryStorage();
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("sensitive persisted contents");
    });

    expectResultError(new LocalStorageIdentityRepository(storage).list(), {
      code: "storage_unavailable",
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("identity.local_store.failed", {
      operation: "read",
      code: "storage_unavailable",
    });
  });

  it("reads the existing v1 localStorage format", () => {
    const storage = new MemoryStorage();
    const identity = { id: FIRST_IDENTITY.publicKeyZ32, publicIdentity: FIRST_IDENTITY };
    storage.setItem("pubky-passport/local-identities/v1", JSON.stringify({
      v: 1,
      activeIdentityId: identity.id,
      identities: [{ ...identity, secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE" }],
    }));
    const repository = new LocalStorageIdentityRepository(storage);

    expect(expectResultOk(repository.list())).toEqual({ activeIdentityId: identity.id, identities: [identity] });
    expect(expectResultOk(repository.readActive())).toEqual({
      identity,
      secretKey: { bytes: new Uint8Array(32).fill(1), format: PUBKY_SECRET_KEY_FORMAT },
    });
  });

  it("clears only Passport local identities", () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageIdentityRepository(storage);
    storage.setItem("unrelated", "keep");
    save(repository, FIRST_IDENTITY, 1);

    expectResultOk(repository.clear());

    expect(expectResultOk(repository.list())).toEqual({ activeIdentityId: null, identities: [] });
    expect(storage.getItem("unrelated")).toBe("keep");
  });

  it("uses one last-write-wins write without read-back retries", () => {
    const storage = new MemoryStorage();
    const getItem = vi.spyOn(storage, "getItem");
    const setItem = vi.spyOn(storage, "setItem");
    const repository = new LocalStorageIdentityRepository(storage);

    save(repository, FIRST_IDENTITY, 1);

    expect(setItem).toHaveBeenCalledOnce();
    expect(getItem).toHaveBeenCalledOnce();
  });

  it("notifies subscribers when another document changes the identity store", () => {
    const repository = new LocalStorageIdentityRepository(new MemoryStorage());
    const listener = vi.fn();
    const unsubscribe = repository.subscribe(listener);

    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "pubky-passport/local-identities/v1" }));
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    unsubscribe();
    window.dispatchEvent(new StorageEvent("storage", { key: "pubky-passport/local-identities/v1" }));

    expect(listener).toHaveBeenCalledTimes(2);
  });
});

function save(repository: LocalStorageIdentityRepository, publicIdentity: typeof FIRST_IDENTITY, byte: number) {
  return expectResultOk(repository.save(
    { id: publicIdentity.publicKeyZ32, publicIdentity },
    { bytes: new Uint8Array(32).fill(byte), format: PUBKY_SECRET_KEY_FORMAT },
  ));
}
