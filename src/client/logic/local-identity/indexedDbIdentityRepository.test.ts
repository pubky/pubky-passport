/** @vitest-environment jsdom */

import { Result } from "better-result";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectResultError, expectResultOk } from "../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../libs/logger/logger";
import { PUBKY_SECRET_KEY_FORMAT, type PubkyPublicIdentity } from "../pubky/pubkyIdentityKey";
import { IndexedDbIdentityRepository } from "./IndexedDbIdentityRepository";

const FIRST_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECOND_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const FIRST_IDENTITY = { publicKeyZ32: FIRST_KEY };
const SECOND_IDENTITY = { publicKeyZ32: SECOND_KEY };
const DATABASE_NAME = "pubky-passport/local-identities";
const IDENTITIES_STORE = "identities";
const SETTINGS_STORE = "settings";
const ACTIVE_IDENTITY_SETTING = "activePublicKeyZ32";

class TestBroadcastChannel {
  private static readonly messageListeners = new Set<() => void>();

  static deliverFromAnotherTab(): void {
    for (const listener of this.messageListeners) listener();
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === "message") TestBroadcastChannel.messageListeners.add(listener);
  }

  postMessage(): void {}
}

describe("IndexedDbIdentityRepository", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("stores independent binary records and selects the latest identity", async () => {
    const repository = new IndexedDbIdentityRepository();
    const first = await save(repository, FIRST_IDENTITY, 1);
    const second = await save(repository, SECOND_IDENTITY, 2);

    expect(expectResultOk(await new IndexedDbIdentityRepository().list())).toEqual({
      activePublicKeyZ32: SECOND_KEY,
      identities: [first, second],
    });
    const storedFirst = await readRecord(IDENTITIES_STORE, FIRST_KEY);
    expect(readStoredPublicKey(storedFirst)).toBe(FIRST_KEY);
    expect(Array.from(readStoredSecretKey(storedFirst))).toEqual(new Array(32).fill(1));
    expect(await readRecord(SETTINGS_STORE, ACTIVE_IDENTITY_SETTING)).toEqual({
      key: ACTIVE_IDENTITY_SETTING,
      value: SECOND_KEY,
    });
  });

  it("does not lose writes made through concurrent repository instances", async () => {
    await Promise.all([
      save(new IndexedDbIdentityRepository(), FIRST_IDENTITY, 1),
      save(new IndexedDbIdentityRepository(), SECOND_IDENTITY, 2),
    ]);

    expect(expectResultOk(await new IndexedDbIdentityRepository().list()).identities).toEqual([
      { publicIdentity: FIRST_IDENTITY },
      { publicIdentity: SECOND_IDENTITY },
    ]);
  });

  it("returns deeply immutable identity snapshots", async () => {
    const repository = new IndexedDbIdentityRepository();
    expectResultOk(
      await repository.save(
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

    const catalog = expectResultOk(await repository.list());
    const identity = catalog.identities[0];
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.identities)).toBe(true);
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(identity?.publicIdentity)).toBe(true);
    expect(Object.isFrozen(identity?.googleAccount)).toBe(true);
  });

  it("selects, replaces, and returns caller-owned secret bytes", async () => {
    const repository = new IndexedDbIdentityRepository();
    await save(repository, FIRST_IDENTITY, 1);
    await save(repository, SECOND_IDENTITY, 2);
    const secondRecord = await readRecord(IDENTITIES_STORE, SECOND_KEY);

    expectResultOk(await repository.select(FIRST_KEY));
    await save(repository, FIRST_IDENTITY, 3);

    expect(await readRecord(IDENTITIES_STORE, SECOND_KEY)).toEqual(secondRecord);
    expect(expectResultOk(await repository.list()).activePublicKeyZ32).toBe(FIRST_KEY);
    const firstRead = expectResultOk(await repository.read(FIRST_KEY));
    firstRead.secretKey.bytes.fill(9);
    expect(expectResultOk(await repository.read(FIRST_KEY)).secretKey.bytes).toEqual(
      new Uint8Array(32).fill(3),
    );
  });

  it("repairs a stale active identity without returning a dead-end catalog", async () => {
    const repository = new IndexedDbIdentityRepository();
    await save(repository, FIRST_IDENTITY, 1);
    await writeRecord(SETTINGS_STORE, { key: ACTIVE_IDENTITY_SETTING, value: SECOND_KEY });

    expect(expectResultOk(await repository.list()).activePublicKeyZ32).toBe(FIRST_KEY);
    expect(await readRecord(SETTINGS_STORE, ACTIVE_IDENTITY_SETTING)).toEqual({
      key: ACTIVE_IDENTITY_SETTING,
      value: FIRST_KEY,
    });
  });

  it("removes one record and selects a remaining identity atomically", async () => {
    const repository = new IndexedDbIdentityRepository();
    const first = await save(repository, FIRST_IDENTITY, 1);
    await save(repository, SECOND_IDENTITY, 2);

    expectResultOk(await repository.remove(SECOND_KEY));
    expect(expectResultOk(await repository.list())).toEqual({
      activePublicKeyZ32: FIRST_KEY,
      identities: [first],
    });
    expect(await readRecord(IDENTITIES_STORE, SECOND_KEY)).toBeUndefined();
  });

  it("notifies same-tab and cross-tab subscribers", async () => {
    const repository = new IndexedDbIdentityRepository();
    const listener = vi.fn();
    const unsubscribe = repository.subscribe(listener);

    await save(repository, FIRST_IDENTITY, 1);
    TestBroadcastChannel.deliverFromAnotherTab();
    unsubscribe();
    await save(repository, SECOND_IDENTITY, 2);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("isolates a throwing subscriber from mutations and other subscribers", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const repository = new IndexedDbIdentityRepository();
    const healthyListener = vi.fn();
    const unsubscribeThrowing = repository.subscribe(() => {
      throw new TypeError("listener failed");
    });
    const unsubscribeHealthy = repository.subscribe(healthyListener);

    expectResultOk(await repository.save({ publicIdentity: FIRST_IDENTITY }, secret(1)));
    expectResultOk(await repository.select(FIRST_KEY));

    expect(healthyListener).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith(
      "identity.indexed_db.listener.failed",
      expect.objectContaining({
        source: "same_tab",
        diagnosticId: expect.any(String),
        errorName: "TypeError",
      }),
    );
    unsubscribeThrowing();
    unsubscribeHealthy();
  });

  it("aborts the whole save transaction when its active-identity write fails", async () => {
    const repository = new IndexedDbIdentityRepository();
    const first = await save(repository, FIRST_IDENTITY, 1);
    const writeFailure = new DOMException("sensitive write details", "QuotaExceededError");
    failNextPut(SETTINGS_STORE, writeFailure);

    expectResultError(await repository.save({ publicIdentity: SECOND_IDENTITY }, secret(2)), {
      code: "storage_unavailable",
      cause: writeFailure,
    });
    expect(expectResultOk(await repository.list())).toEqual({
      activePublicKeyZ32: FIRST_KEY,
      identities: [first],
    });
  });

  it("aborts the whole remove transaction when replacement selection fails", async () => {
    const repository = new IndexedDbIdentityRepository();
    const first = await save(repository, FIRST_IDENTITY, 1);
    const second = await save(repository, SECOND_IDENTITY, 2);
    const writeFailure = new DOMException("sensitive write details", "QuotaExceededError");
    failNextPut(SETTINGS_STORE, writeFailure);

    expectResultError(await repository.remove(SECOND_KEY), {
      code: "storage_unavailable",
      cause: writeFailure,
    });
    expect(expectResultOk(await repository.list())).toEqual({
      activePublicKeyZ32: SECOND_KEY,
      identities: [first, second],
    });
  });

  it("rejects incompatible records and invalid input metadata", async () => {
    const repository = new IndexedDbIdentityRepository();
    await save(repository, FIRST_IDENTITY, 1);
    await writeRecord(IDENTITIES_STORE, {
      v: 2,
      publicKeyZ32: FIRST_KEY,
      secretKey: new Uint8Array(32),
    });
    expectResultError(await repository.list(), { code: "invalid_store" });

    expectResultError(
      await repository.save({ publicIdentity: { publicKeyZ32: "not-a-pubky" } }, secret(1)),
      { code: "invalid_identity" },
    );
    expectResultError(
      await repository.save(
        { publicIdentity: FIRST_IDENTITY },
        { ...secret(1), bytes: new Uint8Array(31) },
      ),
      { code: "invalid_secret_key" },
    );
  });

  it("preserves IndexedDB exceptions without logging their contents", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new DOMException("sensitive browser policy details", "SecurityError");
    vi.stubGlobal("indexedDB", {
      open() {
        throw cause;
      },
    });

    const result = await new IndexedDbIdentityRepository().list();

    expect(Result.isError(result) && result.error.code).toBe("storage_unavailable");
    expect(Result.isError(result) && result.error.cause).toBe(cause);
    expect(warning).toHaveBeenCalledWith("identity.indexed_db.failed", {
      operation: "list",
      code: "storage_unavailable",
      diagnosticId: expect.any(String),
      errorName: "SecurityError",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("sensitive browser policy details");
  });
});

async function save(
  repository: IndexedDbIdentityRepository,
  publicIdentity: PubkyPublicIdentity,
  byte: number,
) {
  return expectResultOk(await repository.save({ publicIdentity }, secret(byte)));
}

function secret(byte: number) {
  return { bytes: new Uint8Array(32).fill(byte), format: PUBKY_SECRET_KEY_FORMAT } as const;
}

function readStoredPublicKey(value: unknown): unknown {
  return typeof value === "object" && value !== null && "publicKeyZ32" in value
    ? value.publicKeyZ32
    : undefined;
}

function readStoredSecretKey(value: unknown): Uint8Array {
  if (
    typeof value !== "object" ||
    value === null ||
    !("secretKey" in value) ||
    !ArrayBuffer.isView(value.secretKey)
  ) {
    throw new Error("Expected a stored typed-array secret key.");
  }
  return value.secretKey as Uint8Array;
}

function failNextPut(storeName: string, cause: unknown): void {
  const originalPut = IDBObjectStore.prototype.put;
  let pending = true;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (pending && this.name === storeName) {
      pending = false;
      throw cause;
    }
    return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
  });
}

async function readRecord(storeName: string, key: IDBValidKey): Promise<unknown> {
  const database = await openTestDatabase();
  try {
    const transaction = database.transaction(storeName, "readonly");
    const value = await testRequest(transaction.objectStore(storeName).get(key));
    await transactionCompletion(transaction);
    return value;
  } finally {
    database.close();
  }
}

async function writeRecord(storeName: string, value: unknown): Promise<void> {
  const database = await openTestDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    await transactionCompletion(transaction);
  } finally {
    database.close();
  }
}

function openTestDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function testRequest<Success>(request: IDBRequest<Success>): Promise<Success> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}
