import type { PubkyFacade } from "../config/PassportClientOptions.js";
import { readProfileDocument } from "../flow/pubkyFlowAdapter.js";
import type { ProfileRead } from "./PassportProfile.js";
import { validateProfile } from "./validateProfile.js";

/** Reads `profile.json` once; a document that fails validation counts as no profile. */
export async function readProfile(
  publicKey: string,
  pubky?: PubkyFacade,
  pkarrRelays?: readonly string[],
): Promise<ProfileRead> {
  const document = await readProfileDocument(publicKey, pubky, pkarrRelays);
  if (document.kind !== "found") return document;
  try {
    const profile = await validateProfile(document.bytes);
    return profile ? { kind: "found", profile } : { kind: "missing" };
  } catch {
    return { kind: "error" };
  }
}
