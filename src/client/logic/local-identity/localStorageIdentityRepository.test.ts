/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../../test-utils/MemoryStorage";
import { expectResultError, expectResultOk } from "../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../libs/logger/logger";
import { PUBKY_SECRET_KEY_FORMAT, type PubkyPublicIdentity } from "../pubky/pubkyIdentityKey";
import { LocalStorageIdentityRepository } from "./LocalStorageIdentityRepository";

const FIRST_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECOND_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const FIRST_IDENTITY = { publicKeyZ32: FIRST_KEY };
const SECOND_IDENTITY = { publicKeyZ32: SECOND_KEY };
const IDENTITY_PREFIX = "pubky-passport/local-identities/v2/identity/";

describe("LocalStorageIdentityRepository", () => {
  beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("stores identities in independent records and selects the latest", () => {
    const repository = new LocalStorageIdentityRepository();
    const first = save(repository, FIRST_IDENTITY, 1);
    const second = save(repository, SECOND_IDENTITY, 2);

    expect(expectResultOk(new LocalStorageIdentityRepository().list())).toEqual({
      activePublicKeyZ32: SECOND_KEY,
      identities: [first, second],
    });
    expect(localStorage.getItem(`${IDENTITY_PREFIX}${FIRST_KEY}`)).toContain(FIRST_KEY);
    expect(localStorage.getItem(`${IDENTITY_PREFIX}${SECOND_KEY}`)).toContain(SECOND_KEY);
    expect(localStorage.getItem("pubky-passport/local-identities/v2/active")).toBe(SECOND_KEY);
  });

  it("does not lose writes made through concurrent repository instances", () => {
    save(new LocalStorageIdentityRepository(), FIRST_IDENTITY, 1);
    save(new LocalStorageIdentityRepository(), SECOND_IDENTITY, 2);

    expect(expectResultOk(new LocalStorageIdentityRepository().list()).identities)
      .toEqual([{ publicIdentity: FIRST_IDENTITY }, { publicIdentity: SECOND_IDENTITY }]);
  });

  it("selects, replaces, and reads one identity without rewriting the others", () => {
    const repository = new LocalStorageIdentityRepository();
    save(repository, FIRST_IDENTITY, 1);
    save(repository, SECOND_IDENTITY, 2);
    const secondRecord = localStorage.getItem(`${IDENTITY_PREFIX}${SECOND_KEY}`);

    expectResultOk(repository.select(FIRST_KEY));
    save(repository, FIRST_IDENTITY, 3);

    expect(localStorage.getItem(`${IDENTITY_PREFIX}${SECOND_KEY}`)).toBe(secondRecord);
    expect(expectResultOk(repository.list()).activePublicKeyZ32).toBe(FIRST_KEY);
    expect(expectResultOk(repository.read(FIRST_KEY)).secretKey.bytes)
      .toEqual(new Uint8Array(32).fill(3));
  });

  it("repairs a stale active key and never returns a dead-end catalog", () => {
    const repository = new LocalStorageIdentityRepository();
    save(repository, FIRST_IDENTITY, 1);
    localStorage.setItem("pubky-passport/local-identities/v2/active", SECOND_KEY);

    expect(expectResultOk(repository.list()).activePublicKeyZ32).toBe(FIRST_KEY);
  });

  it("removes one record and selects a remaining identity", () => {
    const repository = new LocalStorageIdentityRepository();
    save(repository, FIRST_IDENTITY, 1);
    save(repository, SECOND_IDENTITY, 2);

    expectResultOk(repository.remove(SECOND_KEY));
    expect(expectResultOk(repository.list())).toEqual({
      activePublicKeyZ32: FIRST_KEY,
      identities: [{ publicIdentity: FIRST_IDENTITY }],
    });
  });

  it("migrates the legacy array while dropping duplicated display state", () => {
    localStorage.setItem("pubky-passport/local-identities/v1", JSON.stringify({
      v: 1,
      activePublicKeyZ32: FIRST_KEY,
      identities: [{
        publicIdentity: { publicKeyZ32: FIRST_KEY, publicKeyDisplay: `pubky${FIRST_KEY}` },
        secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      }],
    }));

    expect(expectResultOk(new LocalStorageIdentityRepository().list())).toEqual({
      activePublicKeyZ32: FIRST_KEY,
      identities: [{ publicIdentity: FIRST_IDENTITY }],
    });
    expect(localStorage.getItem(`${IDENTITY_PREFIX}${FIRST_KEY}`)).not.toContain("publicKeyDisplay");
  });

  it("notifies subscribers for same-tab and browser storage changes", () => {
    const repository = new LocalStorageIdentityRepository();
    const listener = vi.fn();
    const unsubscribe = repository.subscribe(listener);

    save(repository, FIRST_IDENTITY, 1);
    window.dispatchEvent(new StorageEvent("storage", { key: `${IDENTITY_PREFIX}${SECOND_KEY}` }));
    unsubscribe();
    save(repository, SECOND_IDENTITY, 2);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed records and input metadata", () => {
    localStorage.setItem("pubky-passport/local-identities/v2/migrated", "1");
    localStorage.setItem(`${IDENTITY_PREFIX}${FIRST_KEY}`, '{"v":2,"secretKey":"plaintext"}');
    expectResultError(new LocalStorageIdentityRepository().list(), { code: "invalid_store" });

    localStorage.clear();
    expectResultError(new LocalStorageIdentityRepository().save(
      { publicIdentity: { publicKeyZ32: "not-a-pubky" } },
      secret(1),
    ), { code: "invalid_identity" });
    expectResultError(new LocalStorageIdentityRepository().save(
      { publicIdentity: FIRST_IDENTITY },
      { ...secret(1), bytes: new Uint8Array(31) },
    ), { code: "invalid_secret_key" });
  });

  it("maps storage exceptions without logging their contents", () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new TypeError("sensitive persisted contents");
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw cause; });

    const result = new LocalStorageIdentityRepository().list();

    expect(Result.isError(result) && result.error.code).toBe("storage_unavailable");
    expect(JSON.stringify(warning.mock.calls)).not.toContain("sensitive persisted contents");
  });
});

function save(
  repository: LocalStorageIdentityRepository,
  publicIdentity: PubkyPublicIdentity,
  byte: number,
) {
  return expectResultOk(repository.save({ publicIdentity }, secret(byte)));
}

function secret(byte: number) {
  return { bytes: new Uint8Array(32).fill(byte), format: PUBKY_SECRET_KEY_FORMAT } as const;
}
