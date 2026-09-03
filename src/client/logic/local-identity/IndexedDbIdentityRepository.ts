import "client-only";

import { Result, type Result as ResultType } from "better-result";

import {
  isGoogleAccountProfile,
  type GoogleAccountProfile,
} from "../../../libs/googleAccountProfile";
import { LOGGER, safeErrorLogFields } from "../../../libs/logger/logger";
import type { CodedFailure } from "../../../libs/result";
import {
  isPubkyPublicIdentity,
  isPubkyPublicKey,
  PUBKY_SECRET_KEY_BYTES,
  PUBKY_SECRET_KEY_FORMAT,
  type PubkySecretKeyMaterial,
} from "../pubky/pubkyIdentityKey";
import type { LocalIdentityCatalog, LocalIdentityMetadata } from "./localIdentityModels";

type StoredLocalIdentity = {
  v: 1;
  publicKeyZ32: string;
  googleAccount?: GoogleAccountProfile;
  secretKey: Uint8Array;
};

type StoredSetting = {
  key: string;
  value: string;
};

export type LocalIdentityErrorCode =
  "invalid_identity" | "invalid_secret_key" | "invalid_store" | "storage_unavailable";

export type LocalIdentityResult<Success> = ResultType<
  Success,
  CodedFailure<LocalIdentityErrorCode>
>;

const DATABASE_NAME = "pubky-passport/local-identities";
const DATABASE_VERSION = 1;
const IDENTITIES_STORE = "identities";
const SETTINGS_STORE = "settings";
const ACTIVE_IDENTITY_SETTING = "activePublicKeyZ32";
const CHANGES_CHANNEL = "pubky-passport/local-identities/changes/v1";
const SAME_TAB_LISTENERS = new Set<() => void>();
let changesChannel: BroadcastChannel | null | undefined;

/**
 * Persists local identities in IndexedDB and updates related records atomically.
 *
 * Secret keys remain plaintext data available to same-origin JavaScript. IndexedDB removes the
 * synchronous localStorage and string-encoding path; it is not a confidentiality boundary. Public
 * asynchronous methods settle with a Result and do not intentionally reject. Returned key bytes
 * are caller-owned copies that callers should clear after use, though JavaScript cannot guarantee
 * that every internal or browser-managed copy is erased.
 */
export class IndexedDbIdentityRepository {
  async list(): Promise<LocalIdentityResult<LocalIdentityCatalog>> {
    const read = await withDatabase("list", async (database) =>
      runTransaction(
        database,
        [IDENTITIES_STORE, SETTINGS_STORE],
        "readwrite",
        async (transaction) => {
          const identitiesRequest = transaction.objectStore(IDENTITIES_STORE).getAll();
          const activeRequest = transaction
            .objectStore(SETTINGS_STORE)
            .get(ACTIVE_IDENTITY_SETTING);
          const [storedIdentities, storedActiveIdentity]: [unknown[], unknown] = await Promise.all([
            requestValue<unknown[]>(identitiesRequest),
            requestValue<unknown>(activeRequest),
          ]);

          try {
            if (!storedIdentities.every(isStoredIdentity)) return invalidStore("list");
            const activeIdentity = parseActiveIdentity(storedActiveIdentity, "list");
            if (Result.isError(activeIdentity)) return Result.err(activeIdentity.error);

            const activePublicKeyZ32 = storedIdentities.some(
              (identity) => identity.publicKeyZ32 === activeIdentity.value,
            )
              ? activeIdentity.value
              : (storedIdentities[0]?.publicKeyZ32 ?? null);
            const repairedActiveIdentity = activePublicKeyZ32 !== activeIdentity.value;
            if (repairedActiveIdentity) {
              await writeActiveIdentity(transaction, activePublicKeyZ32);
            }

            return Result.ok({
              catalog: Object.freeze({
                activePublicKeyZ32,
                identities: Object.freeze(storedIdentities.map(toMetadata)),
              }),
              repairedActiveIdentity,
            });
          } finally {
            clearStoredSecretKeys(storedIdentities);
          }
        },
      ),
    );
    if (Result.isError(read)) return Result.err(read.error);
    if (read.value.repairedActiveIdentity) notifyIdentityChanges();
    return Result.ok(read.value.catalog);
  }

  async save(
    identity: LocalIdentityMetadata,
    secretKey: PubkySecretKeyMaterial,
  ): Promise<LocalIdentityResult<LocalIdentityMetadata>> {
    try {
      if (
        !isPubkyPublicIdentity(identity.publicIdentity) ||
        (identity.googleAccount !== undefined && !isGoogleAccountProfile(identity.googleAccount))
      ) {
        return invalidIdentity("save");
      }
      if (
        secretKey.format !== PUBKY_SECRET_KEY_FORMAT ||
        secretKey.bytes.byteLength !== PUBKY_SECRET_KEY_BYTES
      ) {
        LOGGER.warn("identity.indexed_db.failed", {
          operation: "save",
          code: "invalid_secret_key",
        });
        return Result.err({ code: "invalid_secret_key" });
      }

      const stored: StoredLocalIdentity = {
        v: 1,
        publicKeyZ32: identity.publicIdentity.publicKeyZ32,
        ...(identity.googleAccount ? { googleAccount: { ...identity.googleAccount } } : {}),
        secretKey: Uint8Array.from(secretKey.bytes),
      };
      try {
        const saved = await withDatabase("save", async (database) =>
          runTransaction(
            database,
            [IDENTITIES_STORE, SETTINGS_STORE],
            "readwrite",
            async (transaction) => {
              const identityRequest = transaction.objectStore(IDENTITIES_STORE).put(stored);
              const activeIdentityWrite = writeActiveIdentity(transaction, stored.publicKeyZ32);
              await Promise.all([requestValue(identityRequest), activeIdentityWrite]);
              return Result.ok(toMetadata(stored));
            },
          ),
        );
        if (Result.isOk(saved)) notifyIdentityChanges();
        return saved;
      } finally {
        stored.secretKey.fill(0);
      }
    } catch (e) {
      return storageUnavailable("save", e);
    }
  }

  async select(publicKeyZ32: string): Promise<LocalIdentityResult<void>> {
    if (!isPubkyPublicKey(publicKeyZ32)) return invalidIdentity("select");

    const selected = await withDatabase("select", async (database) =>
      runTransaction(
        database,
        [IDENTITIES_STORE, SETTINGS_STORE],
        "readwrite",
        async (transaction) => {
          const stored = await requestValue<unknown>(
            transaction.objectStore(IDENTITIES_STORE).get(publicKeyZ32),
          );
          try {
            if (stored === undefined) return invalidIdentity("select");
            if (!isStoredIdentity(stored) || stored.publicKeyZ32 !== publicKeyZ32) {
              return invalidStore("select");
            }
            await writeActiveIdentity(transaction, publicKeyZ32);
            return Result.ok();
          } finally {
            clearStoredSecretKey(stored);
          }
        },
      ),
    );
    if (Result.isOk(selected)) notifyIdentityChanges();
    return selected;
  }

  async remove(publicKeyZ32: string): Promise<LocalIdentityResult<void>> {
    if (!isPubkyPublicKey(publicKeyZ32)) return invalidIdentity("remove");

    const removed = await withDatabase("remove", async (database) =>
      runTransaction(
        database,
        [IDENTITIES_STORE, SETTINGS_STORE],
        "readwrite",
        async (transaction) => {
          const identities = transaction.objectStore(IDENTITIES_STORE);
          const settings = transaction.objectStore(SETTINGS_STORE);
          const [stored, identityKeys, storedActiveIdentity]: [unknown, IDBValidKey[], unknown] =
            await Promise.all([
              requestValue<unknown>(identities.get(publicKeyZ32)),
              requestValue(identities.getAllKeys()),
              requestValue<unknown>(settings.get(ACTIVE_IDENTITY_SETTING)),
            ]);

          try {
            if (stored === undefined) return invalidIdentity("remove");
            if (!isStoredIdentity(stored) || stored.publicKeyZ32 !== publicKeyZ32) {
              return invalidStore("remove");
            }
            if (!identityKeys.every(isStoredIdentityKey)) return invalidStore("remove");
            const activeIdentity = parseActiveIdentity(storedActiveIdentity, "remove");
            if (Result.isError(activeIdentity)) return Result.err(activeIdentity.error);

            const remainingKeys = identityKeys.filter((key) => key !== publicKeyZ32);
            const activePublicKeyZ32 =
              activeIdentity.value !== publicKeyZ32 &&
              activeIdentity.value !== null &&
              remainingKeys.includes(activeIdentity.value)
                ? activeIdentity.value
                : (remainingKeys[0] ?? null);

            const deleteRequest = identities.delete(publicKeyZ32);
            const activeIdentityWrite =
              activePublicKeyZ32 === activeIdentity.value
                ? undefined
                : writeActiveIdentity(transaction, activePublicKeyZ32);
            const writes: Promise<unknown>[] = [requestValue(deleteRequest)];
            if (activeIdentityWrite) writes.push(activeIdentityWrite);
            await Promise.all(writes);
            return Result.ok();
          } finally {
            clearStoredSecretKey(stored);
          }
        },
      ),
    );
    if (Result.isOk(removed)) notifyIdentityChanges();
    return removed;
  }

  async read(publicKeyZ32: string): Promise<
    LocalIdentityResult<{
      identity: LocalIdentityMetadata;
      secretKey: PubkySecretKeyMaterial;
    }>
  > {
    if (!isPubkyPublicKey(publicKeyZ32)) return invalidIdentity("read");

    return withDatabase("read", async (database) =>
      runTransaction(database, IDENTITIES_STORE, "readonly", async (transaction) => {
        const stored = await requestValue<unknown>(
          transaction.objectStore(IDENTITIES_STORE).get(publicKeyZ32),
        );
        try {
          if (stored === undefined) return invalidIdentity("read");
          if (!isStoredIdentity(stored) || stored.publicKeyZ32 !== publicKeyZ32) {
            return invalidStore("read");
          }
          return Result.ok({
            identity: toMetadata(stored),
            secretKey: {
              bytes: Uint8Array.from(stored.secretKey),
              format: PUBKY_SECRET_KEY_FORMAT,
            },
          });
        } finally {
          clearStoredSecretKey(stored);
        }
      }),
    );
  }

  subscribe(listener: () => void): () => void {
    SAME_TAB_LISTENERS.add(listener);
    getChangesChannel();
    return () => {
      SAME_TAB_LISTENERS.delete(listener);
    };
  }
}

async function withDatabase<Success>(
  operation: string,
  work: (database: IDBDatabase) => Promise<LocalIdentityResult<Success>>,
): Promise<LocalIdentityResult<Success>> {
  let database: IDBDatabase | undefined;
  try {
    database = await openDatabase();
    return await work(database);
  } catch (e) {
    return storageUnavailable(operation, e);
  } finally {
    if (database) closeDatabase(database, operation);
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      const factory = globalThis.indexedDB;
      if (!factory) {
        reject(new Error("IndexedDB is unavailable."));
        return;
      }
      request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (e) {
      reject(e);
      return;
    }

    let settled = false;
    let upgradeFailure: unknown;
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      reject(cause);
    };

    request.onupgradeneeded = () => {
      try {
        const database = request.result;
        if (!database.objectStoreNames.contains(IDENTITIES_STORE)) {
          database.createObjectStore(IDENTITIES_STORE, { keyPath: "publicKeyZ32" });
        }
        if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
          database.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
        }
      } catch (e) {
        upgradeFailure = e;
        try {
          request.transaction?.abort();
        } catch (abortFailure) {
          LOGGER.warn("identity.indexed_db.cleanup.failed", {
            operation: "upgrade_abort",
            ...safeErrorLogFields(abortFailure),
          });
        }
        fail(e);
      }
    };
    request.onerror = () => fail(upgradeFailure ?? request.error ?? new Error("Open failed."));
    request.onblocked = () => fail(new Error("IndexedDB upgrade was blocked."));
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        closeDatabase(database, "late_open");
        return;
      }
      settled = true;
      database.onversionchange = () => closeDatabase(database, "version_change");
      resolve(database);
    };
  });
}

/** Keeps an IndexedDB transaction alive through its requests and resolves only after commit. */
function runTransaction<Success>(
  database: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => Promise<Success>,
): Promise<Success> {
  const transaction = database.transaction(stores, mode);
  return new Promise((resolve, reject) => {
    let completed = false;
    let workCompleted = false;
    let workFailure: unknown;
    let value: Success;

    const finish = () => {
      if (completed && workCompleted) resolve(value);
    };
    transaction.oncomplete = () => {
      completed = true;
      finish();
    };
    transaction.onabort = () => {
      reject(workFailure ?? transaction.error ?? new Error("IndexedDB transaction aborted."));
    };

    let pendingWork: Promise<Success>;
    try {
      pendingWork = work(transaction);
    } catch (e) {
      pendingWork = Promise.reject(e);
    }
    pendingWork
      .then((result) => {
        value = result;
        workCompleted = true;
        finish();
      })
      .catch((e: unknown) => {
        workFailure = e;
        try {
          transaction.abort();
        } catch (abortFailure) {
          LOGGER.warn("identity.indexed_db.cleanup.failed", {
            operation: "transaction_abort",
            ...safeErrorLogFields(abortFailure),
          });
        }
        reject(e);
      });
  });
}

function requestValue<Success>(request: IDBRequest<Success>): Promise<Success> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function writeActiveIdentity(
  transaction: IDBTransaction,
  publicKeyZ32: string | null,
): Promise<unknown> {
  const settings = transaction.objectStore(SETTINGS_STORE);
  return publicKeyZ32 === null
    ? requestValue(settings.delete(ACTIVE_IDENTITY_SETTING))
    : requestValue(
        settings.put({ key: ACTIVE_IDENTITY_SETTING, value: publicKeyZ32 } satisfies StoredSetting),
      );
}

function parseActiveIdentity(
  value: unknown,
  operation: string,
): LocalIdentityResult<string | null> {
  if (value === undefined) return Result.ok(null);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["key", "value"]) ||
    value.key !== ACTIVE_IDENTITY_SETTING ||
    !isPubkyPublicKey(value.value)
  ) {
    return invalidStore(operation);
  }
  return Result.ok(value.value);
}

function isStoredIdentity(value: unknown): value is StoredLocalIdentity {
  return (
    isRecord(value) &&
    hasExactKeys(
      value,
      value.googleAccount === undefined
        ? ["v", "publicKeyZ32", "secretKey"]
        : ["v", "publicKeyZ32", "googleAccount", "secretKey"],
    ) &&
    value.v === 1 &&
    isPubkyPublicKey(value.publicKeyZ32) &&
    isUint8Array(value.secretKey) &&
    value.secretKey.byteLength === PUBKY_SECRET_KEY_BYTES &&
    (value.googleAccount === undefined || isGoogleAccountProfile(value.googleAccount))
  );
}

function isStoredIdentityKey(value: IDBValidKey): value is string {
  return typeof value === "string" && isPubkyPublicKey(value);
}

function toMetadata(identity: StoredLocalIdentity): LocalIdentityMetadata {
  return Object.freeze({
    publicIdentity: Object.freeze({ publicKeyZ32: identity.publicKeyZ32 }),
    ...(identity.googleAccount
      ? { googleAccount: Object.freeze({ ...identity.googleAccount }) }
      : {}),
  });
}

function clearStoredSecretKeys(values: unknown[]): void {
  for (const value of values) clearStoredSecretKey(value);
}

function clearStoredSecretKey(value: unknown): void {
  if (!isRecord(value) || !isUint8Array(value.secretKey)) return;
  value.secretKey.fill(0);
}

function isUint8Array(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Uint8Array]"
  );
}

function notifyIdentityChanges(): void {
  notifyListeners("same_tab");
  try {
    getChangesChannel()?.postMessage({ v: 1 });
  } catch (e) {
    // Persistence already committed, so notification failure is logged without masking success.
    LOGGER.warn("identity.indexed_db.notification.failed", {
      source: "broadcast",
      ...safeErrorLogFields(e),
    });
  }
}

function getChangesChannel(): BroadcastChannel | null {
  if (changesChannel !== undefined) return changesChannel;
  try {
    if (typeof globalThis.BroadcastChannel !== "function") {
      changesChannel = null;
      return changesChannel;
    }
    changesChannel = new globalThis.BroadcastChannel(CHANGES_CHANNEL);
    changesChannel.addEventListener("message", () => notifyListeners("cross_tab"));
  } catch (e) {
    changesChannel = null;
    LOGGER.warn("identity.indexed_db.notification.failed", {
      source: "channel_initialize",
      ...safeErrorLogFields(e),
    });
  }
  return changesChannel;
}

function notifyListeners(source: "same_tab" | "cross_tab"): void {
  for (const listener of SAME_TAB_LISTENERS) {
    try {
      listener();
    } catch (e) {
      LOGGER.warn("identity.indexed_db.listener.failed", {
        source,
        ...safeErrorLogFields(e),
      });
    }
  }
}

function closeDatabase(database: IDBDatabase, operation: string): void {
  try {
    database.close();
  } catch (e) {
    // Closing is cleanup after the operation outcome is known, so it must not replace that outcome.
    LOGGER.warn("identity.indexed_db.cleanup.failed", {
      operation,
      ...safeErrorLogFields(e),
    });
  }
}

function invalidIdentity(operation: string): LocalIdentityResult<never> {
  LOGGER.info("identity.indexed_db.failed", { operation, code: "invalid_identity" });
  return Result.err({ code: "invalid_identity" });
}

function invalidStore(operation: string): LocalIdentityResult<never> {
  LOGGER.warn("identity.indexed_db.failed", { operation, code: "invalid_store" });
  return Result.err({ code: "invalid_store" });
}

function storageUnavailable(operation: string, cause: unknown): LocalIdentityResult<never> {
  LOGGER.warn("identity.indexed_db.failed", {
    operation,
    code: "storage_unavailable",
    ...safeErrorLogFields(cause),
  });
  return Result.err({ code: "storage_unavailable", cause });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
