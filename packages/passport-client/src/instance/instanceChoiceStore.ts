export type ChoiceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * The Passport the person chose, as its bare origin; the app's own Passport is never stored.
 * Storage stays lazy; after a storage failure this store uses its page-local memory.
 */
export function createInstanceChoiceStore(defaultOrigin: string, getStorage: () => ChoiceStorage) {
  const key = `pubky-passport:instance:${defaultOrigin}`;
  let memory: string | null = null;
  let unavailable = false;
  function removePersisted(): void {
    try {
      getStorage().removeItem(key);
    } catch {
      unavailable = true;
    }
  }
  return {
    read(): string | undefined {
      if (!unavailable) {
        try {
          memory = getStorage().getItem(key);
        } catch {
          unavailable = true;
        }
      }
      return memory ?? undefined;
    },
    write(origin: string): void {
      memory = origin;
      if (unavailable) {
        removePersisted();
        return;
      }
      try {
        getStorage().setItem(key, origin);
      } catch {
        unavailable = true;
        // Keep this page's new choice, but do not resurrect an older choice on reload.
        removePersisted();
      }
    },
    clear(): void {
      memory = null;
      removePersisted();
    },
  };
}
