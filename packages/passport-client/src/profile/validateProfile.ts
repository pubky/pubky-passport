import type { PassportProfile } from "./PassportProfile.js";

/**
 * The only module that loads pubky-app-specs, and only after a sign-in: the same validation and
 * sanitising pubky.app applies. `undefined` means the document is not a valid profile; a failure
 * to load the specs throws.
 */
export async function validateProfile(bytes: Uint8Array): Promise<PassportProfile | undefined> {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
  const specs = await import("pubky-app-specs");
  let user: InstanceType<typeof specs.PubkyAppUser> | undefined;
  try {
    user = specs.PubkyAppUser.fromJson(json);
    return deepFreeze(user.toJson() as PassportProfile);
  } catch {
    return undefined;
  } finally {
    try {
      user?.free();
    } catch {
      /* Freeing a WASM handle cannot change the result. */
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
