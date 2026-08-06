import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";
import type { GoogleAccountProfile } from "../../../core/identity/googleAccountProfile";
import { decodeBase64Url, encodeBase64Url, isCanonicalBase64Url } from "../../../libs/encoding/base64Url";
import { LOGGER } from "../../../libs/logger/logger";
import { PUBKY_SECRET_KEY_BYTES, PUBKY_SECRET_KEY_FORMAT, type PubkySecretKeyMaterial } from "../../pubky/pubkyIdentityKey";

export type LocalIdentitySummary = {
  id: string;
  publicIdentity: PubkyPublicIdentity;
  googleAccount?: GoogleAccountProfile;
};

export type LocalIdentityErrorCode =
  | "invalid_identity"
  | "invalid_secret_key"
  | "invalid_store"
  | "no_active_identity"
  | "storage_unavailable";

export type LocalIdentityResult<T> = ResultType<T, { code: LocalIdentityErrorCode }>;

const STORAGE_KEY = "pubky-passport/local-identities/v1";
const LOCAL_IDENTITY_STORE_VERSION = 1;
const STORAGE_NOTIFICATION_HUBS = new WeakMap<Storage, StorageNotificationHub>();

type StorageNotificationHub = {
  listeners: Set<() => void>;
  target: Window | null;
  onStorage: (event: StorageEvent) => void;
  listening: boolean;
};

type StoredLocalIdentity = LocalIdentitySummary & {
  secretKey: string;
};

type LocalIdentityStoreV1 = {
  v: typeof LOCAL_IDENTITY_STORE_VERSION;
  activeIdentityId: string | null;
  identities: StoredLocalIdentity[];
};

export class LocalStorageIdentityRepository {
  readonly #storage: Storage | null;

  constructor(storage?: Storage | null) {
    this.#storage = storage === undefined ? getLocalStorage() : storage;
  }

  list(): LocalIdentityResult<{ activeIdentityId: string | null; identities: LocalIdentitySummary[] }> {
    const store = this.readStore();
    if (Result.isError(store)) {
      return Result.err(store.error);
    }

    return Result.ok({
      activeIdentityId: store.value.activeIdentityId,
      identities: store.value.identities.map(toSummary),
    });
  }

  save(identity: LocalIdentitySummary, secretKey: PubkySecretKeyMaterial): LocalIdentityResult<LocalIdentitySummary> {
    if (identity.id !== identity.publicIdentity.publicKeyZ32) {
      return failure("save", "invalid_identity");
    }
    if (secretKey.format !== PUBKY_SECRET_KEY_FORMAT || secretKey.bytes.byteLength !== PUBKY_SECRET_KEY_BYTES) {
      return failure("save", "invalid_secret_key");
    }

    const store = this.readStore();
    if (Result.isError(store)) {
      return Result.err(store.error);
    }

    const storedIdentity: StoredLocalIdentity = {
      ...identity,
      secretKey: encodeBase64Url(secretKey.bytes),
    };
    const existingIndex = store.value.identities.findIndex((candidate) => candidate.id === storedIdentity.id);
    const identities = [...store.value.identities];
    if (existingIndex === -1) {
      identities.push(storedIdentity);
    } else {
      identities[existingIndex] = storedIdentity;
    }

    const nextStore: LocalIdentityStoreV1 = {
      v: LOCAL_IDENTITY_STORE_VERSION,
      activeIdentityId: storedIdentity.id,
      identities,
    };
    const written = this.writeStore(nextStore);
    if (Result.isError(written)) {
      return Result.err(written.error);
    }

    return Result.ok(toSummary(storedIdentity));
  }

  select(id: string): LocalIdentityResult<void> {
    const store = this.readStore();
    if (Result.isError(store)) {
      return Result.err(store.error);
    }

    if (!store.value.identities.some((identity) => identity.id === id)) {
      return failure("select", "invalid_identity");
    }

    return this.writeStore({ ...store.value, activeIdentityId: id });
  }

  remove(id: string): LocalIdentityResult<void> {
    const store = this.readStore();
    if (Result.isError(store)) return Result.err(store.error);
    if (!store.value.identities.some((identity) => identity.id === id)) return failure("remove", "invalid_identity");

    const identities = store.value.identities.filter((identity) => identity.id !== id);
    const activeIdentityId = store.value.activeIdentityId === id
      ? identities[0]?.id ?? null
      : store.value.activeIdentityId;
    return this.writeStore({ ...store.value, activeIdentityId, identities });
  }

  clear(): LocalIdentityResult<void> {
    if (!this.#storage) {
      return localStoreFailure("clear", "storage_unavailable");
    }

    try {
      this.#storage.removeItem(STORAGE_KEY);
      notifyStorage(this.#storage);
      return Result.ok();
    } catch {
      return localStoreFailure("clear", "storage_unavailable");
    }
  }

  subscribe(listener: () => void): () => void {
    return subscribeToStorage(this.#storage, listener);
  }

  readActive(): LocalIdentityResult<{ identity: LocalIdentitySummary; secretKey: PubkySecretKeyMaterial }> {
    const store = this.readStore();
    if (Result.isError(store)) {
      return Result.err(store.error);
    }

    if (!store.value.activeIdentityId) {
      return failure("read_active", "no_active_identity");
    }

    const storedIdentity = store.value.identities.find((candidate) => candidate.id === store.value.activeIdentityId);
    if (!storedIdentity) {
      return failure("read_active", "no_active_identity");
    }

    const secretKey = decodeStoredSecretKey(storedIdentity.secretKey);
    if (!secretKey) {
      return localStoreFailure("read", "invalid_store");
    }

    return Result.ok({
      identity: toSummary(storedIdentity),
      secretKey: { bytes: secretKey, format: PUBKY_SECRET_KEY_FORMAT },
    });
  }

  private readStore(): LocalIdentityResult<LocalIdentityStoreV1> {
    if (!this.#storage) {
      return localStoreFailure("read", "storage_unavailable");
    }

    let stored: string | null;
    try {
      stored = this.#storage.getItem(STORAGE_KEY);
    } catch {
      return localStoreFailure("read", "storage_unavailable");
    }

    if (stored === null) {
      return Result.ok({ v: LOCAL_IDENTITY_STORE_VERSION, activeIdentityId: null, identities: [] });
    }

    try {
      const parsed: unknown = JSON.parse(stored);
      return isStoreV1(parsed) ? Result.ok(parsed) : localStoreFailure("read", "invalid_store");
    } catch {
      return localStoreFailure("read", "invalid_store");
    }
  }

  private writeStore(store: LocalIdentityStoreV1): LocalIdentityResult<void> {
    if (!this.#storage) {
      return localStoreFailure("write", "storage_unavailable");
    }

    try {
      this.#storage.setItem(STORAGE_KEY, JSON.stringify(store));
      notifyStorage(this.#storage);
      return Result.ok();
    } catch {
      return localStoreFailure("write", "storage_unavailable");
    }
  }
}

function subscribeToStorage(storage: Storage | null, listener: () => void): () => void {
  if (!storage) return () => {};
  let hub = STORAGE_NOTIFICATION_HUBS.get(storage);
  if (!hub) {
    const listeners = new Set<() => void>();
    const target = getStorageEventTarget();
    hub = {
      listeners,
      target,
      listening: false,
      onStorage: (event) => {
        if ((event.key === STORAGE_KEY || event.key === null)
          && (!event.storageArea || event.storageArea === storage)) {
          notifyListeners(listeners);
        }
      },
    };
    if (target) {
      try {
        target.addEventListener("storage", hub.onStorage);
        hub.listening = true;
      } catch {
        LOGGER.warn("identity.local_store.failed", { operation: "subscribe", code: "listener_failed" });
      }
    }
    STORAGE_NOTIFICATION_HUBS.set(storage, hub);
  }
  hub.listeners.add(listener);

  return () => {
    const activeHub = STORAGE_NOTIFICATION_HUBS.get(storage);
    if (!activeHub) return;
    activeHub.listeners.delete(listener);
    if (activeHub.listeners.size > 0) return;
    if (activeHub.target && activeHub.listening) {
      try {
        activeHub.target.removeEventListener("storage", activeHub.onStorage);
      } catch {
        LOGGER.warn("identity.local_store.failed", { operation: "unsubscribe", code: "listener_failed" });
      }
    }
    STORAGE_NOTIFICATION_HUBS.delete(storage);
  };
}

function notifyStorage(storage: Storage): void {
  const hub = STORAGE_NOTIFICATION_HUBS.get(storage);
  if (hub) notifyListeners(hub.listeners);
}

function notifyListeners(listeners: Set<() => void>): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      LOGGER.warn("identity.local_store.failed", { operation: "notify", code: "listener_failed" });
    }
  }
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.window?.localStorage ?? globalThis.localStorage;
  } catch {
    return null;
  }
}

function getStorageEventTarget(): Window | null {
  return globalThis.window ?? null;
}

function isStoreV1(value: unknown): value is LocalIdentityStoreV1 {
  if (!isRecord(value)) {
    return false;
  }

  if (value.v !== LOCAL_IDENTITY_STORE_VERSION || !Array.isArray(value.identities)) {
    return false;
  }

  if (!isActiveIdentityId(value.activeIdentityId) || !value.identities.every(isStoredIdentity)) {
    return false;
  }

  const ids = new Set(value.identities.map((identity) => identity.id));
  return ids.size === value.identities.length && (value.activeIdentityId === null || ids.has(value.activeIdentityId));
}

function isStoredIdentity(value: unknown): value is StoredLocalIdentity {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isPublicIdentity(value.publicIdentity)) {
    return false;
  }

  return value.id === value.publicIdentity.publicKeyZ32 && isEncodedSecretKey(value.secretKey)
    && (value.googleAccount === undefined || isGoogleAccount(value.googleAccount));
}

function isPublicIdentity(value: unknown): value is PubkyPublicIdentity {
  return isRecord(value) && isNonEmptyString(value.publicKeyZ32) && isNonEmptyString(value.publicKeyDisplay);
}

function isGoogleAccount(value: unknown): value is GoogleAccountProfile {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.email) && isNonEmptyString(value.name)
    && (value.pictureUrl === null || typeof value.pictureUrl === "string");
}

function isActiveIdentityId(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isEncodedSecretKey(value: unknown): value is string {
  return typeof value === "string" && value.length === 43 && isCanonicalBase64Url(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSummary(identity: StoredLocalIdentity): LocalIdentitySummary {
  return {
    id: identity.id,
    publicIdentity: identity.publicIdentity,
    ...(identity.googleAccount ? { googleAccount: identity.googleAccount } : {}),
  };
}

function decodeStoredSecretKey(value: string): Uint8Array | undefined {
  const decoded = decodeBase64Url(value);
  return decoded?.byteLength === PUBKY_SECRET_KEY_BYTES ? decoded : undefined;
}

function failure<T>(
  operation: "save" | "select" | "remove" | "read_active",
  code: LocalIdentityErrorCode,
): LocalIdentityResult<T> {
  const expectedOutcome = code === "no_active_identity"
    || ((operation === "select" || operation === "remove") && code === "invalid_identity");
  LOGGER[expectedOutcome ? "info" : "warn"]("identity.local_store.failed", { operation, code });
  return Result.err({ code });
}

function localStoreFailure<T>(
  operation: "read" | "write" | "clear",
  code: "storage_unavailable" | "invalid_store",
): LocalIdentityResult<T> {
  LOGGER.warn("identity.local_store.failed", { operation, code });
  return Result.err({ code });
}
