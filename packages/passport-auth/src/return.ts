import {
  isId,
  isOutcome,
  MESSAGE_VERSION,
  RETURN_MESSAGE_TYPE,
  RETURN_QUERY,
  type PassportOutcome,
  type ReturnMessage,
} from "./protocol.js";

export type { PassportOutcome } from "./protocol.js";

export type PassportReturnResult =
  /** The outcome went to the opener and this window is closing. */
  | { status: "forwarded"; outcome: PassportOutcome }
  /** Opened without a reachable opener (e.g. a new tab): show a link back to your app. */
  | { status: "no-opener"; outcome: PassportOutcome }
  /** The URL carries no valid attempt or outcome. */
  | { status: "invalid" };

/**
 * Runs on the callback page (`callbackUrl`). Passport navigates the popup here only when it could
 * not hand the outcome to the opener. Forwards that outcome to the opener on this origin and
 * closes the popup. The query string is an untrusted hint; it never signs anyone in.
 */
export function handlePassportReturn(): PassportReturnResult {
  const params = new URLSearchParams(window.location.search);
  const attemptId = params.get(RETURN_QUERY.attempt);
  const outcome = params.get(RETURN_QUERY.outcome);
  if (!isId(attemptId) || !isOutcome(outcome)) return { status: "invalid" };

  const opener = liveOpener();
  if (!opener) return { status: "no-opener", outcome };
  const message: ReturnMessage = {
    type: RETURN_MESSAGE_TYPE,
    version: MESSAGE_VERSION,
    attemptId,
    outcome,
  };
  try {
    // Same origin only: the opener ignores this message from anywhere else.
    opener.postMessage(message, window.location.origin);
  } catch {
    return { status: "no-opener", outcome };
  }
  // Close on the next task so the message is queued before the opener can see `closed`.
  setTimeout(() => window.close(), 0);
  return { status: "forwarded", outcome };
}

function liveOpener(): Window | undefined {
  try {
    const opener = window.opener as Window | null;
    return opener && !opener.closed ? opener : undefined;
  } catch {
    return undefined;
  }
}
