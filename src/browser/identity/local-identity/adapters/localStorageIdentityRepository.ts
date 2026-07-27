import "client-only";

import { Result } from "better-result";

import type { PubkyPublicIdentity } from "../../../../core/identity/pubkyIdentity";
import { decodeBase64Url, encodeBase64Url, isCanonicalBase64Url } from "../../../../libs/encoding/base64Url";
import { pubkySecretKeyBytes, pubkySecretKeyFormat, type PubkySecretKeyMaterial } from "../../../pubky/application/pubkyIdentityKeys";
import type { LocalIdentitySummary } from "../application/localIdentity";
import type {
  LocalIdentityRepository,
  LocalIdentityRepositoryErrorCode,
  LocalIdentityRepositoryResult,
} from "../application/localIdentityRepository";

const storageKey = "pubky-passport/local-identities/v1";
const localIdentityStoreVersion = 1;

type StoredLocalIdentity = LocalIdentitySummary & {
  secretKey: string;
};

type LocalIdentityStoreV1 = {
  v: typeof localIdentityStoreVersion;
  activeIdentityId: string | null;
  identities: StoredLocalIdentity[];
};

export class LocalStorageIdentityRepository implements LocalIdentityRepository {
  readonly #storage: Storage | null;

  constructor(options: { storage?: Storage | null } = {}) {
    this.#storage = options.storage === undefined ? getLocalStorage() : options.storage;
  }

  list(): LocalIdentityRepositoryResult<{ activeIdentityId: string | null; identities: LocalIdentitySummary[] }> {
    const store = this.readStore();
    if (Result.isError(store)) {
      return Result.err(store.error);
    }

    return Result.ok({
      activeIdentityId: store.value.activeIdentityId,
      identities: store.value.identities.map(toSummary),
    });
  }

  save(input: { identity: LocalIdentitySummary; secretKey: PubkySecretKeyMaterial }): LocalIdentityRepositoryResult<LocalIdentitySummary> {
    if (input.identity.id !== input.identity.publicIdentity.publicKeyZ32) {
      return failure("invalid_identity");
    }
    if (input.secretKey.format !== pubkySecretKeyFormat || input.secretKey.bytes.byteLength !== pubkySecretKeyBytes) {
      return failure("invalid_secret_key");
    }

    const store = this.readStore();
    if (Result.isError(store)) {
      return Result.err(store.error);
    }

    const identity: StoredLocalIdentity = {
      ...input.identity,
      secretKey: encodeBase64Url(input.secretKey.bytes),
    };
    const existingIndex = store.value.identities.findIndex((candidate) => candidate.id === identity.id);
    const identities = [...store.value.identities];
    if (existingIndex === -1) {
      identities.push(identity);
    } else {
      identities[existingIndex] = identity;
    }

    const nextStore: LocalIdentityStoreV1 = {
      v: localIdentityStoreVersion,
      activeIdentityId: identity.id,
      identities,
    };
    const written = this.writeStore(nextStore);
    if (Result.isError(written)) {
      return Result.err(written.error);
    }

    return Result.ok(toSummary(identity));
  }

  select(id: string): LocalIdentityRepositoryResult<void> {
    const store = this.readStore();
    if (Result.isError(store)) {
      return Result.err(store.error);
    }

    if (!store.value.identities.some((identity) => identity.id === id)) {
      return failure("invalid_identity");
    }

    return this.writeStore({ ...store.value, activeIdentityId: id });
  }

  clear(): LocalIdentityRepositoryResult<void> {
    if (!this.#storage) {
      return failure("storage_unavailable");
    }

    try {
      this.#storage.removeItem(storageKey);
      return Result.ok();
    } catch {
      return failure("storage_unavailable");
    }
  }

  subscribe(listener: () => void): () => void {
    const target = getStorageEventTarget();
    if (!target) return () => {};

    const onStorage = (event: StorageEvent) => {
      if ((event.key === storageKey || event.key === null)
        && (!event.storageArea || event.storageArea === this.#storage)) {
        listener();
      }
    };
    target.addEventListener("storage", onStorage);
    return () => target.removeEventListener("storage", onStorage);
  }

  readActive(): LocalIdentityRepositoryResult<{ identity: LocalIdentitySummary; secretKey: PubkySecretKeyMaterial }> {
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
      return failure("invalid_store");
    }

    return Result.ok({
      identity: toSummary(storedIdentity),
      secretKey: { bytes: secretKey, format: pubkySecretKeyFormat },
    });
  }

  private readStore(): LocalIdentityRepositoryResult<LocalIdentityStoreV1> {
    if (!this.#storage) {
      return failure("storage_unavailable");
    }

    let stored: string | null;
    try {
      stored = this.#storage.getItem(storageKey);
    } catch {
      return failure("storage_unavailable");
    }

    if (stored === null) {
      return Result.ok({ v: localIdentityStoreVersion, activeIdentityId: null, identities: [] });
    }

    try {
      const parsed: unknown = JSON.parse(stored);
      return isStoreV1(parsed) ? Result.ok(parsed) : failure("invalid_store");
    } catch {
      return failure("invalid_store");
    }
  }

  private writeStore(store: LocalIdentityStoreV1): LocalIdentityRepositoryResult<void> {
    if (!this.#storage) {
      return failure("storage_unavailable");
    }

    try {
      this.#storage.setItem(storageKey, JSON.stringify(store));
      return Result.ok();
    } catch {
      return failure("storage_unavailable");
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

  if (value.v !== localIdentityStoreVersion || !Array.isArray(value.identities)) {
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
  return decoded?.byteLength === pubkySecretKeyBytes ? decoded : undefined;
}

function failure<T>(code: LocalIdentityRepositoryErrorCode): LocalIdentityRepositoryResult<T> {
  return Result.err({ code });
}
