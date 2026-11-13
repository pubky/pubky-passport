import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";

/**
 * Grant ids of the short-lived root sessions this browser's Passport opened and has not yet
 * signed out, per identity. A sign-out that never reaches the homeserver (closed tab, network
 * error) leaves its grant here, so Authorized apps can revoke exactly the grants Passport
 * created instead of anything that only carries Passport's client id.
 *
 * Each grant is its own storage key, so tabs recording and forgetting at the same time never
 * overwrite each other's records. Grant ids and public keys are not secrets. Every operation is
 * best effort: storage that is missing, full or failing never fails the Pubky operation around it.
 */
export interface PassportSessionLedger {
  record(publicKeyZ32: string, grantId: string): void;
  forget(publicKeyZ32: string, grantIds: readonly string[]): void;
  recorded(publicKeyZ32: string): ReadonlySet<string>;
}

const STORAGE_PREFIX = "pubky-passport/open-sessions/v1/";
/** Bounds the record if sign-outs keep failing; the oldest records are dropped first. */
const MAX_GRANTS_PER_IDENTITY = 32;
const MAX_ID_LENGTH = 128;

type LedgerRecord = { grantId: string; recordedAt: number };

export const browserPassportSessionLedger: PassportSessionLedger = {
  record(publicKeyZ32, grantId) {
    if (!isValidId(publicKeyZ32) || !isValidId(grantId)) return;
    withStorage("record", (storage) => {
      storage.setItem(storageKey(publicKeyZ32, grantId), String(Date.now()));
      const records = recordsOf(storage, publicKeyZ32);
      const excess = records.length - MAX_GRANTS_PER_IDENTITY;
      for (const stale of records.slice(0, Math.max(0, excess))) {
        storage.removeItem(storageKey(publicKeyZ32, stale.grantId));
      }
    });
  },
  forget(publicKeyZ32, grantIds) {
    if (grantIds.length === 0 || !isValidId(publicKeyZ32)) return;
    withStorage("forget", (storage) => {
      for (const grantId of grantIds) {
        if (isValidId(grantId)) storage.removeItem(storageKey(publicKeyZ32, grantId));
      }
    });
  },
  recorded(publicKeyZ32) {
    if (!isValidId(publicKeyZ32)) return new Set();
    const grantIds = withStorage("read", (storage) =>
      recordsOf(storage, publicKeyZ32).map((record) => record.grantId),
    );
    return new Set(grantIds ?? []);
  },
};

/** This identity's records, oldest first. */
function recordsOf(storage: Storage, publicKeyZ32: string): LedgerRecord[] {
  const prefix = `${STORAGE_PREFIX}${publicKeyZ32}/`;
  const records: LedgerRecord[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null || !key.startsWith(prefix)) continue;
    const grantId = key.slice(prefix.length);
    if (!isValidId(grantId)) continue;
    const recordedAt = Number(storage.getItem(key));
    records.push({ grantId, recordedAt: Number.isFinite(recordedAt) ? recordedAt : 0 });
  }
  return records.sort((a, b) => a.recordedAt - b.recordedAt);
}

function storageKey(publicKeyZ32: string, grantId: string): string {
  return `${STORAGE_PREFIX}${publicKeyZ32}/${grantId}`;
}

/** Keeps ids from adding key segments or growing storage without bound. */
function isValidId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_ID_LENGTH && !value.includes("/");
}

function withStorage<T>(
  operation: "read" | "record" | "forget",
  operate: (storage: Storage) => T,
): T | undefined {
  try {
    const storage = globalThis.window?.localStorage ?? globalThis.localStorage;
    return storage ? operate(storage) : undefined;
  } catch (e) {
    LOGGER.warn("identity.pubky.session_ledger.failed", {
      operation,
      code: "storage_unavailable",
      ...safeErrorLogFields(e),
    });
    return undefined;
  }
}
