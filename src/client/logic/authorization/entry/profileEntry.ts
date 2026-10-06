import "client-only";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { isPubkyPublicKey } from "@/client/logic/pubky/pubkyIdentityKey";

const PROFILE_FRAGMENT = /^#profile=([^&]+)$/u;

/**
 * Reads `/#profile=<key>`: an app that holds a Session for `key` (after a Pubky Ring sign-in)
 * reopens Passport to finish that identity's profile. The key is public; the fragment is still
 * scrubbed so a reload opens home. Anything else in the fragment is not a profile entry.
 */
export function readAndScrubProfileEntry(appWindow: Window): string | undefined {
  const match = PROFILE_FRAGMENT.exec(appWindow.location.hash);
  if (!match) return undefined;
  let key: string;
  try {
    key = decodeURIComponent(match[1]!);
  } catch {
    return undefined;
  }
  if (!isPubkyPublicKey(key)) return undefined;
  try {
    const HistoryConstructor = (appWindow as Window & { History: typeof History }).History;
    HistoryConstructor.prototype.replaceState.call(
      appWindow.history,
      null,
      "",
      appWindow.location.pathname,
    );
  } catch (e) {
    LOGGER.warn("profile.entry.failed", { operation: "scrub_fragment", ...safeErrorLogFields(e) });
  }
  return key;
}
