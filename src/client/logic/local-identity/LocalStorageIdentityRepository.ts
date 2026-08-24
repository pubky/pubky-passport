import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { decodeBase64Url, encodeBase64Url, isCanonicalBase64Url } from "../../../libs/encoding/base64Url";
import { LOGGER } from "../../../libs/logger/logger";
import {
  isPubkyPublicIdentity,
  PUBKY_SECRET_KEY_BYTES,
  PUBKY_SECRET_KEY_FORMAT,
  type PubkySecretKeyMaterial,
} from "../pubky/pubkyIdentityKey";
import type {
  GoogleAccountProfile,
  LocalIdentityCatalog,
  LocalIdentityMetadata,
} from "./localIdentityModels";

type StoredLocalIdentity = LocalIdentityMetadata & {
  secretKey: string;
};

type LocalIdentityStore = {
  v: typeof LOCAL_IDENTITY_STORE_VERSION;
  activePublicKeyZ32: string | null;
  identities: StoredLocalIdentity[];
};

export type LocalIdentityErrorCode =
  | "invalid_identity"
  | "invalid_secret_key"
  | "invalid_store"
  | "storage_unavailable";

export type LocalIdentityResult<Success> = ResultType<Success, { code: LocalIdentityErrorCode }>;

const STORAGE_KEY = "pubky-passport/local-identities/v1";
const LOCAL_IDENTITY_STORE_VERSION = 1;

/**
 * Browser persistence boundary for local Pubky identities.
 *
 * Secret keys are stored unencrypted as canonical base64url. Only `read`
 * returns decoded key material.
 */
export class LocalStorageIdentityRepository {
  constructor(private storage: Storage | null = getLocalStorage()) {}

  /** Returns the identity catalog without secret-key material. */
  list(): LocalIdentityResult<LocalIdentityCatalog> {
    const store = this.readStore();
    if (Result.isError(store)) {
      return Result.err(store.error);
    }

    return Result.ok({
      activePublicKeyZ32: store.value.activePublicKeyZ32,
      identities: store.value.identities.map(toMetadata),
    });
  }

  /** Creates or replaces an identity, persists declared fields, and makes it active. */
  save(identity: LocalIdentityMetadata, secretKey: PubkySecretKeyMaterial): LocalIdentityResult<LocalIdentityMetadata> {
    if (!isPubkyPublicIdentity(identity.publicIdentity)
      || (identity.googleAccount !== undefined && !isStoredGoogleAccountProfile(identity.googleAccount))) {
      LOGGER.warn("identity.local_store.failed", { operation: "save", code: "invalid_identity" });
      return Result.err({ code: "invalid_identity" });
    }
    if (secretKey.format !== PUBKY_SECRET_KEY_FORMAT || secretKey.bytes.byteLength !== PUBKY_SECRET_KEY_BYTES) {
      LOGGER.warn("identity.local_store.failed", { operation: "save", code: "invalid_secret_key" });
      return Result.err({ code: "invalid_secret_key" });
    }

    const store = this.readStore();
    if (Result.isError(store)) {
      return Result.err(store.error);
    }

    const storedIdentity: StoredLocalIdentity = {
      publicIdentity: {
        publicKeyZ32: identity.publicIdentity.publicKeyZ32,
        publicKeyDisplay: identity.publicIdentity.publicKeyDisplay,
      },
      ...(identity.googleAccount ? {
        googleAccount: {
          googleSubject: identity.googleAccount.googleSubject,
          email: identity.googleAccount.email,
          name: identity.googleAccount.name,
          pictureUrl: identity.googleAccount.pictureUrl,
        },
      } : {}),
      secretKey: encodeBase64Url(secretKey.bytes),
    };
    const publicKeyZ32 = storedIdentity.publicIdentity.publicKeyZ32;
    const existingIndex = store.value.identities.findIndex(
      (candidate) => candidate.publicIdentity.publicKeyZ32 === publicKeyZ32,
    );
    const identities = [...store.value.identities];
    if (existingIndex === -1) {
      identities.push(storedIdentity);
    } else {
      identities[existingIndex] = storedIdentity;
    }

    const nextStore: LocalIdentityStore = {
      v: LOCAL_IDENTITY_STORE_VERSION,
      activePublicKeyZ32: publicKeyZ32,
      identities,
    };
    const written = this.writeStore(nextStore);
    if (Result.isError(written)) {
      return Result.err(written.error);
    }

    return Result.ok(toMetadata(storedIdentity));
  }

  select(publicKeyZ32: string): LocalIdentityResult<void> {
    const store = this.readStore();
    if (Result.isError(store)) {
      return Result.err(store.error);
    }

    if (!store.value.identities.some((identity) => identity.publicIdentity.publicKeyZ32 === publicKeyZ32)) {
      LOGGER.info("identity.local_store.failed", { operation: "select", code: "invalid_identity" });
      return Result.err({ code: "invalid_identity" });
    }

    return this.writeStore({ ...store.value, activePublicKeyZ32: publicKeyZ32 });
  }

  /** Removes an identity and selects the first remaining identity when needed. */
  remove(publicKeyZ32: string): LocalIdentityResult<void> {
    const store = this.readStore();
    if (Result.isError(store)) return Result.err(store.error);
    if (!store.value.identities.some((identity) => identity.publicIdentity.publicKeyZ32 === publicKeyZ32)) {
      LOGGER.info("identity.local_store.failed", { operation: "remove", code: "invalid_identity" });
      return Result.err({ code: "invalid_identity" });
    }

    const identities = store.value.identities.filter(
      (identity) => identity.publicIdentity.publicKeyZ32 !== publicKeyZ32,
    );
    const activePublicKeyZ32 = store.value.activePublicKeyZ32 === publicKeyZ32
      ? identities[0]?.publicIdentity.publicKeyZ32 ?? null
      : store.value.activePublicKeyZ32;
    return this.writeStore({ ...store.value, activePublicKeyZ32, identities });
  }

  /** Returns an identity and a fresh secret-key buffer that the caller must clear. */
  read(publicKeyZ32: string): LocalIdentityResult<{ identity: LocalIdentityMetadata; secretKey: PubkySecretKeyMaterial }> {
    const store = this.readStore();
    if (Result.isError(store)) return Result.err(store.error);
    const storedIdentity = store.value.identities.find(
      (candidate) => candidate.publicIdentity.publicKeyZ32 === publicKeyZ32,
    );
    if (!storedIdentity) {
      LOGGER.info("identity.local_store.failed", { operation: "read_identity", code: "invalid_identity" });
      return Result.err({ code: "invalid_identity" });
    }

    const secretKey = decodeStoredSecretKey(storedIdentity.secretKey);
    if (!secretKey) {
      LOGGER.warn("identity.local_store.failed", { operation: "read", code: "invalid_store" });
      return Result.err({ code: "invalid_store" });
    }
    return Result.ok({
      identity: toMetadata(storedIdentity),
      secretKey: { bytes: secretKey, format: PUBKY_SECRET_KEY_FORMAT },
    });
  }

  private readStore(): LocalIdentityResult<LocalIdentityStore> {
    if (!this.storage) {
      LOGGER.warn("identity.local_store.failed", { operation: "read", code: "storage_unavailable" });
      return Result.err({ code: "storage_unavailable" });
    }

    let stored: string | null;
    try {
      stored = this.storage.getItem(STORAGE_KEY);
    } catch {
      LOGGER.warn("identity.local_store.failed", { operation: "read", code: "storage_unavailable" });
      return Result.err({ code: "storage_unavailable" });
    }

    if (stored === null) {
      return Result.ok({ v: LOCAL_IDENTITY_STORE_VERSION, activePublicKeyZ32: null, identities: [] });
    }

    return parseStore(stored);
  }

  private writeStore(store: LocalIdentityStore): LocalIdentityResult<void> {
    if (!this.storage) {
      LOGGER.warn("identity.local_store.failed", { operation: "write", code: "storage_unavailable" });
      return Result.err({ code: "storage_unavailable" });
    }

    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(store));
      return Result.ok();
    } catch {
      LOGGER.warn("identity.local_store.failed", { operation: "write", code: "storage_unavailable" });
      return Result.err({ code: "storage_unavailable" });
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

function parseStore(value: string): LocalIdentityResult<LocalIdentityStore> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (isStore(parsed)) return Result.ok(parsed);
    LOGGER.warn("identity.local_store.failed", { operation: "read", code: "invalid_store" });
    return Result.err({ code: "invalid_store" });
  } catch {
    LOGGER.warn("identity.local_store.failed", { operation: "read", code: "invalid_store" });
    return Result.err({ code: "invalid_store" });
  }
}

function isStore(value: unknown): value is LocalIdentityStore {
  if (!isRecord(value) || !hasExactKeys(value, ["v", "activePublicKeyZ32", "identities"])) {
    return false;
  }

  if (value.v !== LOCAL_IDENTITY_STORE_VERSION || !Array.isArray(value.identities)) {
    return false;
  }

  if (!isActivePublicKeyZ32(value.activePublicKeyZ32) || !value.identities.every(isStoredIdentity)) {
    return false;
  }

  const publicKeys = new Set(value.identities.map((identity) => identity.publicIdentity.publicKeyZ32));
  return publicKeys.size === value.identities.length
    && (value.activePublicKeyZ32 === null || publicKeys.has(value.activePublicKeyZ32));
}

function isStoredIdentity(value: unknown): value is StoredLocalIdentity {
  if (!isRecord(value)
    || !hasExactKeys(value, value.googleAccount === undefined
      ? ["publicIdentity", "secretKey"]
      : ["publicIdentity", "googleAccount", "secretKey"])
    || !isPubkyPublicIdentity(value.publicIdentity)) {
    return false;
  }

  return isEncodedSecretKey(value.secretKey)
    && (value.googleAccount === undefined || isStoredGoogleAccountProfile(value.googleAccount));
}

function isStoredGoogleAccountProfile(value: unknown): value is GoogleAccountProfile {
  return isRecord(value)
    && hasExactKeys(value, ["googleSubject", "email", "name", "pictureUrl"])
    && isNonEmptyString(value.googleSubject)
    && isNonEmptyString(value.email)
    && isNonEmptyString(value.name)
    && (value.pictureUrl === null || isLocalGoogleAvatar(value.pictureUrl));
}

function isLocalGoogleAvatar(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 512 * 1024
    && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value);
}

function isActivePublicKeyZ32(value: unknown): value is string | null {
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

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function toMetadata(identity: StoredLocalIdentity): LocalIdentityMetadata {
  return {
    publicIdentity: identity.publicIdentity,
    ...(identity.googleAccount ? { googleAccount: identity.googleAccount } : {}),
  };
}

function decodeStoredSecretKey(value: string): Uint8Array | undefined {
  const decoded = decodeBase64Url(value);
  return decoded?.byteLength === PUBKY_SECRET_KEY_BYTES ? decoded : undefined;
}
