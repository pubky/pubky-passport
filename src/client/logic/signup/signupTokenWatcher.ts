import "client-only";

import type { SignupTokenStatus } from "@/client/logic/pubky/SignupTokenChecker";
import type { HomeserverSignupDetails } from "./homeserverInvite";

/** How often a handed-off invite is looked up while Passport waits for Pubky Ring. */
export const SIGNUP_TOKEN_WATCH_INTERVAL_MS = 3_000;
/**
 * The longest wait between lookups while the homeserver gives no answer: each failed lookup
 * doubles the wait up to this, so an unreachable homeserver is not asked (and each failure
 * logged) every few seconds for as long as the code is shown.
 */
export const SIGNUP_TOKEN_WATCH_MAX_INTERVAL_MS = 30_000;

type SignupTokenCheck = (
  invite: HomeserverSignupDetails,
  signal: AbortSignal,
) => Promise<SignupTokenStatus>;
/** Runs `callback` after `delayMs` and returns a function that cancels it. */
type Scheduler = (callback: () => void, delayMs: number) => () => void;

const scheduleTimeout: Scheduler = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

/**
 * Looks `invite` up on its homeserver every few seconds until the homeserver reports it used,
 * which is the only sign Passport gets that Pubky Ring finished the signup it was handed; `onUsed`
 * then runs once. Any other answer, including a failed lookup, keeps watching; after a lookup
 * that got no answer (`unknown`) the next waits twice as long, up to
 * {@link SIGNUP_TOKEN_WATCH_MAX_INTERVAL_MS}, and a real answer returns to the usual pace. The
 * lookup is read-only, so watching never consumes the invite. Returns a function that stops
 * watching.
 */
export function watchSignupToken(
  invite: HomeserverSignupDetails,
  check: SignupTokenCheck,
  onUsed: () => void,
  schedule: Scheduler = scheduleTimeout,
): () => void {
  const lookups = new AbortController();
  let delayMs = SIGNUP_TOKEN_WATCH_INTERVAL_MS;
  let cancelTimer = schedule(() => void lookUp(), delayMs);

  async function lookUp(): Promise<void> {
    const status = await check(invite, lookups.signal);
    if (lookups.signal.aborted) return;
    if (status === "used") {
      onUsed();
      return;
    }
    delayMs =
      status === "unknown"
        ? Math.min(delayMs * 2, SIGNUP_TOKEN_WATCH_MAX_INTERVAL_MS)
        : SIGNUP_TOKEN_WATCH_INTERVAL_MS;
    cancelTimer = schedule(() => void lookUp(), delayMs);
  }

  return () => {
    lookups.abort();
    cancelTimer();
  };
}
