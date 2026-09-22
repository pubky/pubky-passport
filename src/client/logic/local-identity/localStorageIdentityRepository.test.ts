/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "@test-utils/MemoryStorage";
import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";
import { LOGGER } from "@/libs/logger/logger";
import {
  PUBKY_SECRET_KEY_FORMAT,
  type PubkyPublicIdentity,
} from "@/client/logic/pubky/pubkyIdentityKey";
import { LocalStorageIdentityRepository } from "./LocalStorageIdentityRepository";

const FIRST_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECOND_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const FIRST_IDENTITY = { publicKeyZ32: FIRST_KEY };
const SECOND_IDENTITY = { publicKeyZ32: SECOND_KEY };
const IDENTITY_PREFIX = "pubky-passport/local-identities/v1/identity/";
const ACTIVE_IDENTITY_KEY = "pubky-passport/local-identities/v1/active";

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
    expect(localStorage.getItem("pubky-passport/local-identities/v1/active")).toBe(SECOND_KEY);
  });

  it("does not lose writes made through concurrent repository instances", () => {
    save(new LocalStorageIdentityRepository(), FIRST_IDENTITY, 1);
    save(new LocalStorageIdentityRepository(), SECOND_IDENTITY, 2);

    expect(expectResultOk(new LocalStorageIdentityRepository().list()).identities).toEqual([
      { publicIdentity: FIRST_IDENTITY },
      { publicIdentity: SECOND_IDENTITY },
    ]);
  });

  it("returns deeply immutable identity snapshots", () => {
    const repository = new LocalStorageIdentityRepository();
    expectResultOk(
      repository.save(
        {
          publicIdentity: FIRST_IDENTITY,
          googleAccount: {
            googleSubject: "google-subject",
            email: "person@example.com",
            name: "Person",
            pictureUrl: null,
          },
        },
        secret(1),
      ),
    );

    const catalog = expectResultOk(repository.list());
    const identity = catalog.identities[0];
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.identities)).toBe(true);
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(identity?.publicIdentity)).toBe(true);
    expect(Object.isFrozen(identity?.googleAccount)).toBe(true);
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
    expect(expectResultOk(repository.read(FIRST_KEY)).secretKey.bytes).toEqual(
      new Uint8Array(32).fill(3),
    );
  });

  it("repairs a stale active key and never returns a dead-end catalog", () => {
    const repository = new LocalStorageIdentityRepository();
    save(repository, FIRST_IDENTITY, 1);
    localStorage.setItem("pubky-passport/local-identities/v1/active", SECOND_KEY);

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

  it("notifies subscribers for same-tab and browser storage changes", () => {
    const repository = new LocalStorageIdentityRepository();
    const listener = vi.fn();
    const unsubscribe = repository.subscribe(listener);

    save(repository, FIRST_IDENTITY, 1);
    const storageEvent = new Event("storage");
    Object.defineProperty(storageEvent, "key", { value: `${IDENTITY_PREFIX}${SECOND_KEY}` });
    window.dispatchEvent(storageEvent);
    unsubscribe();
    save(repository, SECOND_IDENTITY, 2);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("isolates a throwing subscriber from mutations and other subscribers", () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const repository = new LocalStorageIdentityRepository();
    const healthyListener = vi.fn();
    const unsubscribeThrowing = repository.subscribe(() => {
      throw new TypeError("listener failed");
    });
    const unsubscribeHealthy = repository.subscribe(healthyListener);

    expectResultOk(repository.save({ publicIdentity: FIRST_IDENTITY }, secret(1)));
    expectResultOk(repository.select(FIRST_KEY));

    expect(healthyListener).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith(
      "identity.local_store.listener.failed",
      expect.objectContaining({
        source: "same_tab",
        diagnosticId: expect.any(String),
        errorName: "TypeError",
      }),
    );
    unsubscribeThrowing();
    unsubscribeHealthy();
  });

  it("rolls back an identity write when selecting it as active fails", () => {
    const repository = new LocalStorageIdentityRepository();
    const first = save(repository, FIRST_IDENTITY, 1);
    const storage = localStorage as MemoryStorage;
    const setItem = storage.setItem.bind(storage);
    const writeFailure = new DOMException("quota", "QuotaExceededError");
    let rejectActiveWrite = true;
    vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (key === ACTIVE_IDENTITY_KEY && rejectActiveWrite) {
        rejectActiveWrite = false;
        throw writeFailure;
      }
      setItem(key, value);
    });

    expectResultError(repository.save({ publicIdentity: SECOND_IDENTITY }, secret(2)), {
      code: "storage_unavailable",
      cause: writeFailure,
    });

    expect(expectResultOk(repository.list())).toEqual({
      activePublicKeyZ32: FIRST_KEY,
      identities: [first],
    });
    expect(storage.getItem(`${IDENTITY_PREFIX}${SECOND_KEY}`)).toBeNull();
  });

  it("preserves the catalog when writing the identity record fails", () => {
    const repository = new LocalStorageIdentityRepository();
    const first = save(repository, FIRST_IDENTITY, 1);
    const storage = localStorage as MemoryStorage;
    const setItem = storage.setItem.bind(storage);
    const writeFailure = new DOMException("quota", "QuotaExceededError");
    let rejectIdentityWrite = true;
    vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (key === `${IDENTITY_PREFIX}${SECOND_KEY}` && rejectIdentityWrite) {
        rejectIdentityWrite = false;
        throw writeFailure;
      }
      setItem(key, value);
    });

    expectResultError(repository.save({ publicIdentity: SECOND_IDENTITY }, secret(2)), {
      code: "storage_unavailable",
      cause: writeFailure,
    });
    expect(expectResultOk(repository.list())).toEqual({
      activePublicKeyZ32: FIRST_KEY,
      identities: [first],
    });
  });

  it("rolls back active selection when removing its identity fails", () => {
    const repository = new LocalStorageIdentityRepository();
    const first = save(repository, FIRST_IDENTITY, 1);
    const second = save(repository, SECOND_IDENTITY, 2);
    const storage = localStorage as MemoryStorage;
    const removeItem = storage.removeItem.bind(storage);
    const removeFailure = new DOMException("unavailable", "SecurityError");
    let rejectIdentityRemoval = true;
    vi.spyOn(storage, "removeItem").mockImplementation((key) => {
      if (key === `${IDENTITY_PREFIX}${SECOND_KEY}` && rejectIdentityRemoval) {
        rejectIdentityRemoval = false;
        throw removeFailure;
      }
      removeItem(key);
    });

    expectResultError(repository.remove(SECOND_KEY), {
      code: "storage_unavailable",
      cause: removeFailure,
    });

    expect(expectResultOk(repository.list())).toEqual({
      activePublicKeyZ32: SECOND_KEY,
      identities: [first, second],
    });
  });

  it("preserves the identity when selecting its replacement fails", () => {
    const repository = new LocalStorageIdentityRepository();
    const first = save(repository, FIRST_IDENTITY, 1);
    const second = save(repository, SECOND_IDENTITY, 2);
    const storage = localStorage as MemoryStorage;
    const setItem = storage.setItem.bind(storage);
    const writeFailure = new DOMException("unavailable", "SecurityError");
    let rejectActiveWrite = true;
    vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (key === ACTIVE_IDENTITY_KEY && rejectActiveWrite) {
        rejectActiveWrite = false;
        throw writeFailure;
      }
      setItem(key, value);
    });

    expectResultError(repository.remove(SECOND_KEY), {
      code: "storage_unavailable",
      cause: writeFailure,
    });
    expect(expectResultOk(repository.list())).toEqual({
      activePublicKeyZ32: SECOND_KEY,
      identities: [first, second],
    });
  });

  it("rejects incompatible records and invalid input metadata", () => {
    localStorage.setItem(
      `${IDENTITY_PREFIX}${FIRST_KEY}`,
      JSON.stringify({
        v: 2,
        publicKeyZ32: FIRST_KEY,
        secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      }),
    );
    expectResultError(new LocalStorageIdentityRepository().list(), { code: "invalid_store" });

    localStorage.clear();
    expectResultError(
      new LocalStorageIdentityRepository().save(
        { publicIdentity: { publicKeyZ32: "not-a-pubky" } },
        secret(1),
      ),
      { code: "invalid_identity" },
    );
    expectResultError(
      new LocalStorageIdentityRepository().save(
        { publicIdentity: FIRST_IDENTITY },
        { ...secret(1), bytes: new Uint8Array(31) },
      ),
      { code: "invalid_secret_key" },
    );
  });

  it("maps storage exceptions without logging their contents", () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new TypeError("sensitive persisted contents");
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw cause;
    });

    const result = new LocalStorageIdentityRepository().list();

    expect(Result.isError(result) && result.error.code).toBe("storage_unavailable");
    expect(JSON.stringify(warning.mock.calls)).not.toContain("sensitive persisted contents");
  });

  it("preserves exceptions raised while accessing browser storage", () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new DOMException("sensitive browser policy details", "SecurityError");
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw cause;
    });

    const result = new LocalStorageIdentityRepository().list();

    expectResultError(result, { code: "storage_unavailable", cause });
    expect(warning).toHaveBeenCalledWith("identity.local_store.failed", {
      operation: "read",
      code: "storage_unavailable",
      diagnosticId: expect.any(String),
      errorName: "SecurityError",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("sensitive browser policy details");
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
