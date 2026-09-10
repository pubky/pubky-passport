import "client-only";

import { Result, type Result as ResultType } from "better-result";

import {
  decodeBase64Url,
  encodeBase64Url,
  isCanonicalBase64Url,
} from "../../../libs/encoding/base64Url";
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
  secretKey: string;
};

export type LocalIdentityErrorCode =
  "invalid_identity" | "invalid_secret_key" | "invalid_store" | "storage_unavailable";

export type LocalIdentityResult<Success> = ResultType<
  Success,
  CodedFailure<LocalIdentityErrorCode>
>;

const STORAGE_ROOT = "pubky-passport/local-identities/v1";
const IDENTITY_KEY_PREFIX = `${STORAGE_ROOT}/identity/`;
const ACTIVE_IDENTITY_KEY = `${STORAGE_ROOT}/active`;
const SAME_TAB_LISTENERS = new Set<() => void>();

/** Stores each identity independently so concurrent tabs cannot overwrite a shared array. */
export class LocalStorageIdentityRepository {
  list(): LocalIdentityResult<LocalIdentityCatalog> {
    const storageResult = getLocalStorage("read");
    if (Result.isError(storageResult)) return Result.err(storageResult.error);
    const storage = storageResult.value;

    const identities = readAllIdentities(storage);
    if (Result.isError(identities)) return Result.err(identities.error);
    const active = readActiveIdentity(storage);
    if (Result.isError(active)) return Result.err(active.error);

    const activePublicKeyZ32 = identities.value.some(
      (identity) => identity.publicKeyZ32 === active.value,
    )
      ? active.value
      : (identities.value[0]?.publicKeyZ32 ?? null);
    if (activePublicKeyZ32 !== active.value) {
      const repaired = writeActiveIdentity(storage, activePublicKeyZ32);
      if (Result.isError(repaired)) return Result.err(repaired.error);
    }

    return Result.ok(
      Object.freeze({
        activePublicKeyZ32,
        identities: Object.freeze(identities.value.map(toMetadata)),
      }),
    );
  }

  save(
    identity: LocalIdentityMetadata,
    secretKey: PubkySecretKeyMaterial,
  ): LocalIdentityResult<LocalIdentityMetadata> {
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
      LOGGER.warn("identity.local_store.failed", { operation: "save", code: "invalid_secret_key" });
      return Result.err({ code: "invalid_secret_key" });
    }

    const storageResult = getLocalStorage("write");
    if (Result.isError(storageResult)) return Result.err(storageResult.error);
    const storage = storageResult.value;
    const stored: StoredLocalIdentity = {
      v: 1,
      publicKeyZ32: identity.publicIdentity.publicKeyZ32,
      ...(identity.googleAccount ? { googleAccount: { ...identity.googleAccount } } : {}),
      secretKey: encodeBase64Url(secretKey.bytes),
    };

    const storedKey = identityStorageKey(stored.publicKeyZ32);
    let previousIdentity: string | null | undefined;
    let previousActive: string | null | undefined;

    try {
      previousIdentity = storage.getItem(storedKey);
      previousActive = storage.getItem(ACTIVE_IDENTITY_KEY);
      storage.setItem(storedKey, JSON.stringify(stored));
      storage.setItem(ACTIVE_IDENTITY_KEY, stored.publicKeyZ32);
      notifySameTab();
      return Result.ok(toMetadata(stored));
    } catch (e) {
      if (previousIdentity !== undefined && previousActive !== undefined) {
        restoreStorageValues(
          storage,
          [
            [ACTIVE_IDENTITY_KEY, previousActive],
            [storedKey, previousIdentity],
          ],
          "save_rollback",
        );
        notifySameTab();
      }
      return storageUnavailable("write", e);
    }
  }

  select(publicKeyZ32: string): LocalIdentityResult<void> {
    const storageResult = getLocalStorage("write");
    if (Result.isError(storageResult)) return Result.err(storageResult.error);
    const storage = storageResult.value;
    const identity = readIdentity(storage, publicKeyZ32);
    if (Result.isError(identity)) return Result.err(identity.error);
    if (!identity.value) return invalidIdentity("select");

    const written = writeActiveIdentity(storage, publicKeyZ32);
    if (Result.isOk(written)) notifySameTab();
    return written;
  }

  remove(publicKeyZ32: string): LocalIdentityResult<void> {
    const storageResult = getLocalStorage("write");
    if (Result.isError(storageResult)) return Result.err(storageResult.error);
    const storage = storageResult.value;
    const identity = readIdentity(storage, publicKeyZ32);
    if (Result.isError(identity)) return Result.err(identity.error);
    if (!identity.value) return invalidIdentity("remove");

    const active = readActiveIdentity(storage);
    if (Result.isError(active)) return Result.err(active.error);
    let nextActive = active.value;
    if (active.value === publicKeyZ32) {
      const remaining = readAllIdentities(storage);
      if (Result.isError(remaining)) return Result.err(remaining.error);
      nextActive =
        remaining.value.find((candidate) => candidate.publicKeyZ32 !== publicKeyZ32)
          ?.publicKeyZ32 ?? null;
    }

    const storedKey = identityStorageKey(publicKeyZ32);
    const previousIdentity = JSON.stringify(identity.value);

    try {
      if (active.value === publicKeyZ32) writeActiveIdentityOrThrow(storage, nextActive);
      storage.removeItem(storedKey);
      notifySameTab();
      return Result.ok();
    } catch (e) {
      restoreStorageValues(
        storage,
        [
          [storedKey, previousIdentity],
          [ACTIVE_IDENTITY_KEY, active.value],
        ],
        "remove_rollback",
      );
      notifySameTab();
      return storageUnavailable("write", e);
    }
  }

  read(publicKeyZ32: string): LocalIdentityResult<{
    identity: LocalIdentityMetadata;
    secretKey: PubkySecretKeyMaterial;
  }> {
    const storageResult = getLocalStorage("read");
    if (Result.isError(storageResult)) return Result.err(storageResult.error);
    const storage = storageResult.value;
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
      if (event.key === null || event.key.startsWith(`${STORAGE_ROOT}/`))
        notifyListener(listener, "storage_event");
    };
    globalThis.window?.addEventListener("storage", onStorage);
    return () => {
      SAME_TAB_LISTENERS.delete(listener);
      globalThis.window?.removeEventListener("storage", onStorage);
    };
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
  } catch (e) {
    return storageUnavailable("read", e);
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
  } catch (e) {
    return storageUnavailable("read", e);
  }
}

function readActiveIdentity(storage: Storage): LocalIdentityResult<string | null> {
  try {
    const value = storage.getItem(ACTIVE_IDENTITY_KEY);
    return value === null || isPubkyPublicKey(value) ? Result.ok(value) : invalidStore();
  } catch (e) {
    return storageUnavailable("read", e);
  }
}

function writeActiveIdentity(
  storage: Storage,
  publicKeyZ32: string | null,
): LocalIdentityResult<void> {
  try {
    writeActiveIdentityOrThrow(storage, publicKeyZ32);
    return Result.ok();
  } catch (e) {
    return storageUnavailable("write", e);
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
    // Parser messages may echo the stored secret key, so treat malformed records as invalid.
    return null;
  }
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
    isEncodedSecretKey(value.secretKey) &&
    (value.googleAccount === undefined || isGoogleAccountProfile(value.googleAccount))
  );
}

function isEncodedSecretKey(value: unknown): value is string {
  return typeof value === "string" && value.length === 43 && isCanonicalBase64Url(value);
}

function toMetadata(identity: StoredLocalIdentity): LocalIdentityMetadata {
  return Object.freeze({
    publicIdentity: Object.freeze({ publicKeyZ32: identity.publicKeyZ32 }),
    ...(identity.googleAccount
      ? { googleAccount: Object.freeze({ ...identity.googleAccount }) }
      : {}),
  });
}

function decodeStoredSecretKey(value: string): Uint8Array | undefined {
  const decoded = decodeBase64Url(value);
  return decoded?.byteLength === PUBKY_SECRET_KEY_BYTES ? decoded : undefined;
}

function identityStorageKey(publicKeyZ32: string): string {
  return `${IDENTITY_KEY_PREFIX}${publicKeyZ32}`;
}

function notifySameTab(): void {
  for (const listener of SAME_TAB_LISTENERS) notifyListener(listener, "same_tab");
}

function notifyListener(listener: () => void, source: "same_tab" | "storage_event"): void {
  try {
    listener();
  } catch (e) {
    LOGGER.warn("identity.local_store.listener.failed", {
      source,
      ...safeErrorLogFields(e),
    });
  }
}

function restoreStorageValues(
  storage: Storage,
  values: ReadonlyArray<readonly [key: string, value: string | null]>,
  operation: "save_rollback" | "remove_rollback",
): void {
  for (const [key, value] of values) {
    try {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    } catch (e) {
      LOGGER.error("identity.local_store.rollback.failed", {
        operation,
        ...safeErrorLogFields(e),
      });
    }
  }
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
  LOGGER.warn("identity.local_store.failed", {
    operation,
    code: "storage_unavailable",
    ...(cause === undefined ? {} : safeErrorLogFields(cause)),
  });
  return Result.err(
    cause === undefined ? { code: "storage_unavailable" } : { code: "storage_unavailable", cause },
  );
}

function getLocalStorage(operation: "read" | "write"): LocalIdentityResult<Storage> {
  try {
    const storage = globalThis.window?.localStorage ?? globalThis.localStorage;
    return storage ? Result.ok(storage) : storageUnavailable(operation);
  } catch (e) {
    return storageUnavailable(operation, e);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
