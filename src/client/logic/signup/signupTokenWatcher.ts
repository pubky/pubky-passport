import "client-only";

import type { SignupTokenStatus } from "@/client/logic/pubky/SignupTokenChecker";
import {
  type RingAnswerWatchOptions,
  watchForRingAnswer,
} from "@/client/logic/universal-signer/ringAnswerWatch";
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

/**
 * Looks `invite` up on its homeserver every few seconds while the page is in view, until the
 * homeserver reports it used, which is the only sign Passport gets that Pubky Ring finished the
 * signup it was handed; `onUsed` then runs once. Any other answer, including a failed lookup, keeps
 * watching; after a lookup that got no answer (`unknown`) the next waits twice as long, up to
 * {@link SIGNUP_TOKEN_WATCH_MAX_INTERVAL_MS}, and a real answer returns to the usual pace. A hidden
 * page pauses, and coming back looks at once (see `watchForRingAnswer`). The lookup is read-only,
 * so watching never consumes the invite. Returns a function that stops watching.
 */
export function watchSignupToken(
  invite: HomeserverSignupDetails,
  check: SignupTokenCheck,
  onUsed: () => void,
  options?: RingAnswerWatchOptions,
): () => void {
  return watchForRingAnswer(
    async (signal) => {
      const status = await check(invite, signal);
      if (status === "used") return "answered";
      return status === "unknown" ? "unreachable" : "waiting";
    },
    onUsed,
    {
      intervalMs: SIGNUP_TOKEN_WATCH_INTERVAL_MS,
      maxIntervalMs: SIGNUP_TOKEN_WATCH_MAX_INTERVAL_MS,
    },
    options,
  );
}
