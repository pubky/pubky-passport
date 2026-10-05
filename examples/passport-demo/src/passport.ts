/**
 * This demo's Pubky Passport integration: the part an app copies. Everything else in src/ is the
 * page and its playground (app.ts, settings.ts, styles.ts, explainer.ts, dom.ts, style.css) and
 * the files panel the signed-in page uses (files.ts, storage.ts).
 *
 * 1. Configure: `<pubky-passport app-name client-id capabilities>` (configureElement in
 *    settings.ts). Set the attributes before the element joins the page, so a same-tab return
 *    (after a blocked pop-up) resumes with the same options. Without `instance`, sign-in uses the
 *    package's own Passport.
 * 2. Sign in: the element's `passport-session` event hands over the SDK Session, the public key
 *    and the pubky.app profile.
 * 3. Keep: save the Session with the SDK's browser session store.
 * 4. Restore: on load, restore the saved Session, so a reload stays signed in.
 * 5. Sign out: revoke the grant, forget the saved Session, and reset() the element.
 */
import "@pubky/passport-client/element"; // defines <pubky-passport>
import type { PassportProfile, SignedIn } from "@pubky/passport-client";
import type { PassportElement } from "@pubky/passport-client/element";
import { Pubky } from "@synonymdev/pubky";
import { STORAGE_NAMESPACE } from "./config";
import { freeHandle } from "./freeHandle";

/** 2. and 3. `show` returns false to turn a Session away; any other is kept for a reload. */
export function onSignIn(element: PassportElement, show: (signedIn: SignedIn) => boolean): void {
  element.addEventListener("passport-session", ({ detail }) => {
    // A failure to keep it only means a reload asks to sign in again.
    if (show(detail)) void keepSignIn(detail).catch(() => {});
  });
}

// The app's own SDK instance, for its session store. The package signs in with its own.
const pubky = new Pubky();
const SAVED_KEY = `${STORAGE_NAMESPACE}:signed-in`;

/** What the app remembers about a saved sign-in; the Session itself is in the SDK's store. */
interface SavedSignIn {
  /** The SDK session store's ID for the Session. */
  id: string;
  publicKey: string;
  // The profile is public data; a copy lets a reload show the name without reading it again.
  profile: PassportProfile | null;
}

/** Errors that mean the saved Session is gone for good; anything else may be a passing failure. */
const GONE = new Set(["AuthenticationError", "InvalidInput", "ClientStateError"]);

/** 3. Saves the Session with the SDK's store; the app keeps only the store's ID and public facts. */
export async function keepSignIn({ session, publicKey, profile }: SignedIn): Promise<void> {
  const store = pubky.browserSessionStore;
  let stored: { id: string; free(): void } | undefined;
  try {
    stored = await store.save(session);
    const saved: SavedSignIn = { id: stored.id, publicKey, profile };
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    } catch (e) {
      // Without the ID the record could never be found again: don't leave it behind.
      await store.remove(stored.id).catch(() => {});
      throw e;
    }
  } finally {
    freeHandle(stored);
    freeHandle(store);
  }
}

/** 4. The Session an earlier visit saved, while its grant is still valid. */
export async function restoreSignIn(): Promise<SignedIn | undefined> {
  const saved = readSaved();
  if (!saved) return undefined;
  const store = pubky.browserSessionStore;
  try {
    const session = await store.restore(saved.id);
    return { session, publicKey: saved.publicKey, profile: saved.profile };
  } catch (e) {
    // Expired or revoked: forget it. Anything else (offline, a busy browser) keeps it for later.
    if (GONE.has((e as { name?: string })?.name ?? "")) await forgetSaved(saved);
    return undefined;
  } finally {
    freeHandle(store);
  }
}

/** 5. Revokes the grant, forgets the saved Session, and gives each button back. */
export async function signOut(
  { session }: SignedIn,
  buttons: readonly { reset(): void }[],
): Promise<void> {
  // Offline or already revoked: the local copy is still forgotten below.
  await session.signout().catch(() => {});
  freeHandle(session);
  const saved = readSaved();
  if (saved) await forgetSaved(saved);
  for (const button of buttons) button.reset();
}

function readSaved(): SavedSignIn | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "null") as SavedSignIn | null;
    return saved && typeof saved.id === "string" ? saved : undefined;
  } catch {
    return undefined;
  }
}

async function forgetSaved({ id }: SavedSignIn): Promise<void> {
  try {
    localStorage.removeItem(SAVED_KEY);
  } catch {
    // Nothing was saved.
  }
  const store = pubky.browserSessionStore;
  await store.remove(id).catch(() => {});
  freeHandle(store);
}
