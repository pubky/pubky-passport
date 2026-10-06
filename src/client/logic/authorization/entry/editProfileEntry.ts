import "client-only";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { isPubkyPublicKey } from "@/client/logic/pubky/pubkyIdentityKey";

/**
 * `/#edit-profile=<key>`: an app links to the profile editor of the identity it holds a sign-in
 * for. `invalid` is an address that names the link in any other shape.
 */
export type EditProfileEntry = { status: "edit"; publicKeyZ32: string } | { status: "invalid" };

/** Anything in the query or fragment that names the edit link, in any shape. */
const EDIT_PROFILE_MENTION = /(?:^|[?#&])edit-profile(?:[=&#]|$)/u;
/** The one accepted shape: the parameter alone in the fragment, with no query. */
const EDIT_PROFILE_FRAGMENT = /^#edit-profile=([^&#=]+)$/u;

/**
 * Reads `/#edit-profile=<key>` before hydration. The key is public, but the address is scrubbed
 * either way, so a reload opens home. Its only parameter is the z-base-32 key: another parameter, a
 * repeat, a query or a key in any other form makes the link invalid. `undefined`: no edit link.
 */
export function readAndScrubEditProfileEntry(appWindow: Window): EditProfileEntry | undefined {
  const { hash, search } = appWindow.location;
  if (!EDIT_PROFILE_MENTION.test(search) && !EDIT_PROFILE_MENTION.test(hash)) return undefined;
  scrub(appWindow);
  const match = search === "" ? EDIT_PROFILE_FRAGMENT.exec(hash) : null;
  if (!match) return { status: "invalid" };
  let key: string;
  try {
    key = decodeURIComponent(match[1]!);
  } catch {
    return { status: "invalid" };
  }
  return isPubkyPublicKey(key) ? { status: "edit", publicKeyZ32: key } : { status: "invalid" };
}

function scrub(appWindow: Window): void {
  try {
    const HistoryConstructor = (appWindow as Window & { History: typeof History }).History;
    HistoryConstructor.prototype.replaceState.call(
      appWindow.history,
      null,
      "",
      appWindow.location.pathname,
    );
  } catch (e) {
    LOGGER.warn("profile.edit_entry.failed", {
      operation: "scrub_fragment",
      ...safeErrorLogFields(e),
    });
  }
}
