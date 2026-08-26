import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { decodeBase64Url, encodeBase64Url, isCanonicalBase64Url } from "../../../libs/encoding/base64Url";
import { LOGGER } from "../../../libs/logger/logger";
import type { CodedFailure } from "../../../libs/result";
import {
  isPubkyPublicIdentity,
  isPubkyPublicKey,
  PUBKY_SECRET_KEY_BYTES,
  PUBKY_SECRET_KEY_FORMAT,
  type PubkySecretKeyMaterial,
} from "../pubky/pubkyIdentityKey";
import type {
  GoogleAccountProfile,
  LocalIdentityCatalog,
  LocalIdentityMetadata,
} from "./localIdentityModels";

type StoredLocalIdentity = {
  v: 2;
  publicKeyZ32: string;
  googleAccount?: GoogleAccountProfile;
  secretKey: string;
};

type LegacyStoredIdentity = {
  publicIdentity: { publicKeyZ32: string; publicKeyDisplay: string };
  googleAccount?: GoogleAccountProfile;
  secretKey: string;
};

type LegacyStore = {
  v: 1;
  activePublicKeyZ32: string | null;
  identities: LegacyStoredIdentity[];
};

export type LocalIdentityErrorCode =
  | "invalid_identity"
  | "invalid_secret_key"
  | "invalid_store"
  | "storage_unavailable";

export type LocalIdentityResult<Success> = ResultType<Success, CodedFailure<LocalIdentityErrorCode>>;

const LEGACY_STORAGE_KEY = "pubky-passport/local-identities/v1";
const STORAGE_ROOT = "pubky-passport/local-identities/v2";
const IDENTITY_KEY_PREFIX = `${STORAGE_ROOT}/identity/`;
const ACTIVE_IDENTITY_KEY = `${STORAGE_ROOT}/active`;
const MIGRATION_MARKER_KEY = `${STORAGE_ROOT}/migrated`;
const SAME_TAB_LISTENERS = new Set<() => void>();

/** Stores each identity independently so concurrent tabs cannot overwrite a shared array. */
export class LocalStorageIdentityRepository {
  list(): LocalIdentityResult<LocalIdentityCatalog> {
    const storage = getLocalStorage();
    if (!storage) return storageUnavailable("read");
    const migrated = ensureMigrated(storage);
    if (Result.isError(migrated)) return Result.err(migrated.error);

    const identities = readAllIdentities(storage);
    if (Result.isError(identities)) return Result.err(identities.error);
    const active = readActiveIdentity(storage);
    if (Result.isError(active)) return Result.err(active.error);

    const activePublicKeyZ32 = identities.value.some(
      (identity) => identity.publicKeyZ32 === active.value,
    ) ? active.value : identities.value[0]?.publicKeyZ32 ?? null;
    if (activePublicKeyZ32 !== active.value) {
      const repaired = writeActiveIdentity(storage, activePublicKeyZ32);
      if (Result.isError(repaired)) return Result.err(repaired.error);
    }

    return Result.ok({
      activePublicKeyZ32,
      identities: identities.value.map(toMetadata),
    });
  }

  save(
    identity: LocalIdentityMetadata,
    secretKey: PubkySecretKeyMaterial,
  ): LocalIdentityResult<LocalIdentityMetadata> {
    if (!isPubkyPublicIdentity(identity.publicIdentity)
      || (identity.googleAccount !== undefined && !isStoredGoogleAccountProfile(identity.googleAccount))) {
      return invalidIdentity("save");
    }
    if (secretKey.format !== PUBKY_SECRET_KEY_FORMAT
      || secretKey.bytes.byteLength !== PUBKY_SECRET_KEY_BYTES) {
      LOGGER.warn("identity.local_store.failed", { operation: "save", code: "invalid_secret_key" });
      return Result.err({ code: "invalid_secret_key" });
    }

    const storage = getLocalStorage();
    if (!storage) return storageUnavailable("write");
    const migrated = ensureMigrated(storage);
    if (Result.isError(migrated)) return Result.err(migrated.error);
    const stored: StoredLocalIdentity = {
      v: 2,
      publicKeyZ32: identity.publicIdentity.publicKeyZ32,
      ...(identity.googleAccount ? { googleAccount: { ...identity.googleAccount } } : {}),
      secretKey: encodeBase64Url(secretKey.bytes),
    };

    try {
      storage.setItem(identityStorageKey(stored.publicKeyZ32), JSON.stringify(stored));
      storage.setItem(ACTIVE_IDENTITY_KEY, stored.publicKeyZ32);
      notifySameTab();
      return Result.ok(toMetadata(stored));
    } catch (cause) {
      return storageUnavailable("write", cause);
    }
  }

  select(publicKeyZ32: string): LocalIdentityResult<void> {
    const storage = getLocalStorage();
    if (!storage) return storageUnavailable("write");
    const migrated = ensureMigrated(storage);
    if (Result.isError(migrated)) return migrated;
    const identity = readIdentity(storage, publicKeyZ32);
    if (Result.isError(identity)) return Result.err(identity.error);
    if (!identity.value) return invalidIdentity("select");

    const written = writeActiveIdentity(storage, publicKeyZ32);
    if (Result.isOk(written)) notifySameTab();
    return written;
  }

  remove(publicKeyZ32: string): LocalIdentityResult<void> {
    const storage = getLocalStorage();
    if (!storage) return storageUnavailable("write");
    const migrated = ensureMigrated(storage);
    if (Result.isError(migrated)) return migrated;
    const identity = readIdentity(storage, publicKeyZ32);
    if (Result.isError(identity)) return Result.err(identity.error);
    if (!identity.value) return invalidIdentity("remove");

    try {
      storage.removeItem(identityStorageKey(publicKeyZ32));
      if (storage.getItem(ACTIVE_IDENTITY_KEY) === publicKeyZ32) {
        const remaining = readAllIdentities(storage);
        if (Result.isError(remaining)) return Result.err(remaining.error);
        const selected = writeActiveIdentity(storage, remaining.value[0]?.publicKeyZ32 ?? null);
        if (Result.isError(selected)) return selected;
      }
      notifySameTab();
      return Result.ok();
    } catch (cause) {
      return storageUnavailable("write", cause);
    }
  }

  read(publicKeyZ32: string): LocalIdentityResult<{
    identity: LocalIdentityMetadata;
    secretKey: PubkySecretKeyMaterial;
  }> {
    const storage = getLocalStorage();
    if (!storage) return storageUnavailable("read");
    const migrated = ensureMigrated(storage);
    if (Result.isError(migrated)) return Result.err(migrated.error);
    const stored = readIdentity(storage, publicKeyZ32);
    if (Result.isError(stored)) return Result.err(stored.error);
    if (!stored.value) return invalidIdentity("read_identity");

    const secretKey = decodeStoredSecretKey(stored.value.secretKey);
    if (!secretKey) return invalidStore();
    return Result.ok({
      identity: toMetadata(stored.value),
      secretKey: { bytes: secretKey, format: PUBKY_SECRET_KEY_FORMAT },
    });
  }

  subscribe(listener: () => void): () => void {
    SAME_TAB_LISTENERS.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === null
        || event.key === LEGACY_STORAGE_KEY
        || event.key.startsWith(`${STORAGE_ROOT}/`)) listener();
    };
    globalThis.window?.addEventListener("storage", onStorage);
    return () => {
      SAME_TAB_LISTENERS.delete(listener);
      globalThis.window?.removeEventListener("storage", onStorage);
    };
  }
}

function ensureMigrated(storage: Storage): LocalIdentityResult<void> {
  try {
    if (storage.getItem(MIGRATION_MARKER_KEY) === "1") return Result.ok();
    const legacyValue = storage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyValue) return Result.ok();

    const legacy = parseLegacyStore(legacyValue);
    if (!legacy) return invalidStore();
    for (const identity of legacy.identities) {
      const migrated: StoredLocalIdentity = {
        v: 2,
        publicKeyZ32: identity.publicIdentity.publicKeyZ32,
        ...(identity.googleAccount ? { googleAccount: identity.googleAccount } : {}),
        secretKey: identity.secretKey,
      };
      storage.setItem(identityStorageKey(migrated.publicKeyZ32), JSON.stringify(migrated));
    }
    writeActiveIdentityOrThrow(storage, legacy.activePublicKeyZ32);
    storage.setItem(MIGRATION_MARKER_KEY, "1");
    return Result.ok();
  } catch (cause) {
    return storageUnavailable("migrate", cause);
  }
}

function readAllIdentities(storage: Storage): LocalIdentityResult<StoredLocalIdentity[]> {
  const identities: StoredLocalIdentity[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(IDENTITY_KEY_PREFIX)) continue;
      const value = storage.getItem(key);
      if (value === null) continue;
      const identity = parseStoredIdentity(value);
      if (!identity || key !== identityStorageKey(identity.publicKeyZ32)) return invalidStore();
      identities.push(identity);
    }
  } catch (cause) {
    return storageUnavailable("read", cause);
  }
  return Result.ok(identities);
}

function readIdentity(
  storage: Storage,
  publicKeyZ32: string,
): LocalIdentityResult<StoredLocalIdentity | null> {
  if (!isPubkyPublicKey(publicKeyZ32)) return invalidIdentity("read_identity");
  try {
    const value = storage.getItem(identityStorageKey(publicKeyZ32));
    if (value === null) return Result.ok(null);
    const identity = parseStoredIdentity(value);
    return identity ? Result.ok(identity) : invalidStore();
  } catch (cause) {
    return storageUnavailable("read", cause);
  }
}

function readActiveIdentity(storage: Storage): LocalIdentityResult<string | null> {
  try {
    const value = storage.getItem(ACTIVE_IDENTITY_KEY);
    return value === null || isPubkyPublicKey(value) ? Result.ok(value) : invalidStore();
  } catch (cause) {
    return storageUnavailable("read", cause);
  }
}

function writeActiveIdentity(
  storage: Storage,
  publicKeyZ32: string | null,
): LocalIdentityResult<void> {
  try {
    writeActiveIdentityOrThrow(storage, publicKeyZ32);
    return Result.ok();
  } catch (cause) {
    return storageUnavailable("write", cause);
  }
}

function writeActiveIdentityOrThrow(storage: Storage, publicKeyZ32: string | null): void {
  if (publicKeyZ32 === null) storage.removeItem(ACTIVE_IDENTITY_KEY);
  else storage.setItem(ACTIVE_IDENTITY_KEY, publicKeyZ32);
}

function parseStoredIdentity(value: string): StoredLocalIdentity | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isStoredIdentity(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isStoredIdentity(value: unknown): value is StoredLocalIdentity {
  return isRecord(value)
    && hasExactKeys(value, value.googleAccount === undefined
      ? ["v", "publicKeyZ32", "secretKey"]
      : ["v", "publicKeyZ32", "googleAccount", "secretKey"])
    && value.v === 2
    && isPubkyPublicKey(value.publicKeyZ32)
    && isEncodedSecretKey(value.secretKey)
    && (value.googleAccount === undefined || isStoredGoogleAccountProfile(value.googleAccount));
}

function parseLegacyStore(value: string): LegacyStore | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)
      || !hasExactKeys(parsed, ["v", "activePublicKeyZ32", "identities"])
      || parsed.v !== 1
      || !Array.isArray(parsed.identities)
      || !parsed.identities.every(isLegacyIdentity)
      || (parsed.activePublicKeyZ32 !== null && !isPubkyPublicKey(parsed.activePublicKeyZ32))) return null;
    const keys = new Set(parsed.identities.map((identity) => identity.publicIdentity.publicKeyZ32));
    return keys.size === parsed.identities.length
      && (parsed.activePublicKeyZ32 === null || keys.has(parsed.activePublicKeyZ32))
      ? parsed as LegacyStore
      : null;
  } catch {
    return null;
  }
}

function isLegacyIdentity(value: unknown): value is LegacyStoredIdentity {
  if (!isRecord(value)
    || !hasExactKeys(value, value.googleAccount === undefined
      ? ["publicIdentity", "secretKey"]
      : ["publicIdentity", "googleAccount", "secretKey"])
    || !isRecord(value.publicIdentity)
    || !hasExactKeys(value.publicIdentity, ["publicKeyZ32", "publicKeyDisplay"])) return false;
  const publicKeyZ32 = value.publicIdentity.publicKeyZ32;
  return isPubkyPublicKey(publicKeyZ32)
    && value.publicIdentity.publicKeyDisplay === `pubky${publicKeyZ32}`
    && isEncodedSecretKey(value.secretKey)
    && (value.googleAccount === undefined || isStoredGoogleAccountProfile(value.googleAccount));
}

function isStoredGoogleAccountProfile(value: unknown): value is GoogleAccountProfile {
  if (!isRecord(value)
    || !hasExactKeys(value, ["googleSubject", "email", "name", "pictureUrl"])
    || !isNonEmptyString(value.googleSubject)
    || !isNonEmptyString(value.email)
    || !isNonEmptyString(value.name)) return false;
  if (value.pictureUrl === null || isLocalGoogleAvatar(value.pictureUrl)) return true;
  if (!isNonEmptyString(value.pictureUrl) || value.pictureUrl.length > 2_048) return false;
  try {
    const url = new URL(value.pictureUrl);
    return url.protocol === "https:"
      && url.hostname === "lh3.googleusercontent.com"
      && !url.username
      && !url.password
      && !url.hash;
  } catch {
    return false;
  }
}

function isLocalGoogleAvatar(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 512 * 1024
    && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value);
}

function isEncodedSecretKey(value: unknown): value is string {
  return typeof value === "string" && value.length === 43 && isCanonicalBase64Url(value);
}

function toMetadata(identity: StoredLocalIdentity): LocalIdentityMetadata {
  return {
    publicIdentity: { publicKeyZ32: identity.publicKeyZ32 },
    ...(identity.googleAccount ? { googleAccount: identity.googleAccount } : {}),
  };
}

function decodeStoredSecretKey(value: string): Uint8Array | undefined {
  const decoded = decodeBase64Url(value);
  return decoded?.byteLength === PUBKY_SECRET_KEY_BYTES ? decoded : undefined;
}

function identityStorageKey(publicKeyZ32: string): string {
  return `${IDENTITY_KEY_PREFIX}${publicKeyZ32}`;
}

function notifySameTab(): void {
  for (const listener of SAME_TAB_LISTENERS) listener();
}

function invalidIdentity(operation: string): LocalIdentityResult<never> {
  LOGGER.info("identity.local_store.failed", { operation, code: "invalid_identity" });
  return Result.err({ code: "invalid_identity" });
}

function invalidStore(): LocalIdentityResult<never> {
  LOGGER.warn("identity.local_store.failed", { operation: "read", code: "invalid_store" });
  return Result.err({ code: "invalid_store" });
}

function storageUnavailable(operation: string, cause?: unknown): LocalIdentityResult<never> {
  LOGGER.warn("identity.local_store.failed", { operation, code: "storage_unavailable" });
  return Result.err(cause === undefined
    ? { code: "storage_unavailable" }
    : { code: "storage_unavailable", cause });
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.window?.localStorage ?? globalThis.localStorage;
  } catch {
    return null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
