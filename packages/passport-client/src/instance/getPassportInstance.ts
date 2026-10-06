import { DEFAULT_PASSPORT_INSTANCE } from "../shared/defaults.js";
import { createInstanceChoiceStore, type ChoiceStorage } from "./instanceChoiceStore.js";
import { validateInstanceOrigin } from "./instanceOrigin.js";

/**
 * The Passport a sign-in from this page opens now, as an origin: the one the person chose in the
 * element's settings for `defaultInstance`, else `defaultInstance`, else the public Passport. It
 * reads the choice the way sign-in does and ignores one that no longer validates. Synchronous,
 * read-only, and it never throws: an invalid `defaultInstance` counts as unset.
 */
export function getPassportInstance(defaultInstance?: string): string {
  return passportInstanceFrom(defaultInstance, browserStorage);
}

/** Internal seam for tests: the same lookup over another storage. */
export function passportInstanceFrom(
  defaultInstance: unknown,
  getStorage: () => ChoiceStorage,
): string {
  try {
    const own =
      typeof defaultInstance === "string" ? validateInstanceOrigin(defaultInstance) : undefined;
    const origin = own?.ok ? own.origin : DEFAULT_PASSPORT_INSTANCE;
    const choice = createInstanceChoiceStore(origin, getStorage).read();
    if (choice === undefined) return origin;
    const checked = validateInstanceOrigin(choice);
    return checked.ok ? checked.origin : origin;
  } catch {
    return DEFAULT_PASSPORT_INSTANCE;
  }
}

function browserStorage(): ChoiceStorage {
  return window.localStorage;
}
