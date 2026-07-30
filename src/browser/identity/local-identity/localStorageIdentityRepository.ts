import "client-only";

import { Result } from "better-result";

import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";
import { decodeBase64Url, encodeBase64Url, isCanonicalBase64Url } from "../../../libs/encoding/base64Url";
import { LOGGER } from "../../../libs/logger/logger";
import { PUBKY_SECRET_KEY_BYTES, PUBKY_SECRET_KEY_FORMAT, type PubkySecretKeyMaterial } from "../../pubky/pubkyIdentityKey";
import type {
  LocalIdentityErrorCode,
  LocalIdentityResult,
  LocalIdentitySummary,
} from "./localIdentity";

const STORAGE_KEY = "pubky-passport/local-identities/v1";
const LOCAL_IDENTITY_STORE_VERSION = 1;

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

  constructor(options: { storage?: Storage | null } = {}) {
    this.#storage = options.storage === undefined ? getLocalStorage() : options.storage;
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
      return failure("invalid_identity");
    }
    if (secretKey.format !== PUBKY_SECRET_KEY_FORMAT || secretKey.bytes.byteLength !== PUBKY_SECRET_KEY_BYTES) {
      return failure("invalid_secret_key");
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
      return failure("invalid_identity");
    }

    return this.writeStore({ ...store.value, activeIdentityId: id });
  }

  clear(): LocalIdentityResult<void> {
    if (!this.#storage) {
      return localStoreFailure("clear", "storage_unavailable");
    }

    try {
      this.#storage.removeItem(STORAGE_KEY);
      return Result.ok();
    } catch {
      return localStoreFailure("clear", "storage_unavailable");
    }
  }

  subscribe(listener: () => void): () => void {
    const target = getStorageEventTarget();
    if (!target) return () => {};

    const onStorage = (event: StorageEvent) => {
      if ((event.key === STORAGE_KEY || event.key === null)
        && (!event.storageArea || event.storageArea === this.#storage)) {
        listener();
      }
    };
    target.addEventListener("storage", onStorage);
    return () => target.removeEventListener("storage", onStorage);
  }

  readActive(): LocalIdentityResult<{ identity: LocalIdentitySummary; secretKey: PubkySecretKeyMaterial }> {
    const store = this.readStore();
    if (Result.isError(store)) {
      return Result.err(store.error);
    }

    if (!store.value.activeIdentityId) {
      return failure("no_active_identity");
    }

    const storedIdentity = store.value.identities.find((candidate) => candidate.id === store.value.activeIdentityId);
    if (!storedIdentity) {
      return failure("no_active_identity");
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
      return Result.ok();
    } catch {
      return localStoreFailure("write", "storage_unavailable");
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

  return value.id === value.publicIdentity.publicKeyZ32 && isEncodedSecretKey(value.secretKey);
}

function isPublicIdentity(value: unknown): value is PubkyPublicIdentity {
  return isRecord(value) && isNonEmptyString(value.publicKeyZ32) && isNonEmptyString(value.publicKeyDisplay);
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
  return { id: identity.id, publicIdentity: identity.publicIdentity };
}

function decodeStoredSecretKey(value: string): Uint8Array | undefined {
  const decoded = decodeBase64Url(value);
  return decoded?.byteLength === PUBKY_SECRET_KEY_BYTES ? decoded : undefined;
}

function failure<T>(code: LocalIdentityErrorCode): LocalIdentityResult<T> {
  return Result.err({ code });
}

function localStoreFailure<T>(
  operation: "read" | "write" | "clear",
  code: "storage_unavailable" | "invalid_store",
): LocalIdentityResult<T> {
  LOGGER.warn("identity.local_store.failed", { operation, code });
  return failure(code);
}
