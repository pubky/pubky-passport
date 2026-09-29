export type ChoiceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Storage stays lazy; after a storage failure this store uses its page-local memory. */
export function createInstanceChoiceStore(
  defaultOrigin: string,
  getStorage: () => ChoiceStorage,
  onMalformed: () => void,
  now: () => number = Date.now,
) {
  const key = `pubky-passport:instance:${defaultOrigin}`;
  let memory: string | null = null;
  let unavailable = false;
  function readRaw(): string | null {
    if (!unavailable) {
      try {
        memory = getStorage().getItem(key);
      } catch {
        unavailable = true;
      }
    }
    return memory;
  }
  function clear(): void {
    memory = null;
    removePersisted();
  }
  function removePersisted(): void {
    try {
      getStorage().removeItem(key);
    } catch {
      unavailable = true;
    }
  }
  return {
    read(): string | undefined {
      const raw = readRaw();
      if (raw === null) return undefined;
      try {
        const record: unknown = JSON.parse(raw);
        if (isChoiceRecord(record, now())) return record.origin;
      } catch {
        /* Malformed same-origin state is discarded without exposing its contents. */
      }
      clear();
      try {
        onMalformed();
      } catch {
        /* Observers cannot prevent cleanup or the default-instance fallback. */
      }
      return undefined;
    },
    write(origin: string): void {
      memory = JSON.stringify({ v: 1, origin, savedAt: now() });
      if (unavailable) {
        removePersisted();
        return;
      }
      try {
        getStorage().setItem(key, memory);
      } catch {
        unavailable = true;
        // Keep this page's new choice, but do not resurrect an older choice on reload.
        removePersisted();
      }
    },
    clear,
  };
}

function isChoiceRecord(
  value: unknown,
  now: number,
): value is { v: 1; origin: string; savedAt: number } {
  return !!(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join() === "origin,savedAt,v" &&
    "v" in value &&
    value.v === 1 &&
    "origin" in value &&
    typeof value.origin === "string" &&
    "savedAt" in value &&
    typeof value.savedAt === "number" &&
    Number.isFinite(value.savedAt) &&
    value.savedAt <= now + 60_000
  );
}
