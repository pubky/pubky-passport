/**
 * Wire format shared with Pubky Passport (`docs/integration.md`) and with this package's callback
 * page. Nothing here authenticates anyone: only the SDK `Session` from the relay does.
 */

export type PassportOutcome = "success" | "error" | "cancel";

/** Sent by Passport to the opener when the callbacks share the opener's origin. */
export const OUTCOME_MESSAGE_TYPE = "pubky-passport.authorization-outcome";
/** Sent back to Passport so it closes the popup instead of navigating it to the callback. */
export const ACK_MESSAGE_TYPE = "pubky-passport.authorization-outcome-ack";
/** Sent by `handlePassportReturn()` from the callback page to the opener. */
export const RETURN_MESSAGE_TYPE = "pubky-passport-auth.return";
export const MESSAGE_VERSION = 1;

/** Query parameters this package adds to the callback URL. Untrusted hints. */
export const RETURN_QUERY = { attempt: "passport-attempt", outcome: "passport-outcome" } as const;

/** Upper bound for ids read from messages and URLs. Passport and this package use UUIDs. */
const MAXIMUM_ID_LENGTH = 128;

const OUTCOME_KEYS = ["messageId", "outcome", "type", "version"];
const RETURN_KEYS = ["attemptId", "outcome", "type", "version"];

export interface PassportOutcomeMessage {
  outcome: PassportOutcome;
  messageId: string;
}

export interface ReturnMessage {
  type: typeof RETURN_MESSAGE_TYPE;
  version: typeof MESSAGE_VERSION;
  attemptId: string;
  outcome: PassportOutcome;
}

export function isOutcome(value: unknown): value is PassportOutcome {
  return value === "success" || value === "error" || value === "cancel";
}

export function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAXIMUM_ID_LENGTH;
}

/** `/authorize#d=<authorization URL encoded once>`; Passport rejects a query string. */
export function authorizeUrl(instanceOrigin: string, authorizationUrl: string): string {
  return `${instanceOrigin}/authorize#d=${encodeURIComponent(authorizationUrl)}`;
}

/** Callback URL for one outcome of one attempt; the attempt id lets the opener ignore stale pages. */
export function returnUrl(
  callbackUrl: string,
  attemptId: string,
  outcome: PassportOutcome,
): string {
  const url = new URL(callbackUrl);
  url.searchParams.set(RETURN_QUERY.attempt, attemptId);
  url.searchParams.set(RETURN_QUERY.outcome, outcome);
  return url.href;
}

/** Returns Passport's outcome message when `data` has exactly the documented fields. */
export function readOutcomeMessage(data: unknown): PassportOutcomeMessage | undefined {
  if (!hasExactKeys(data, OUTCOME_KEYS)) return undefined;
  if (data.type !== OUTCOME_MESSAGE_TYPE || data.version !== MESSAGE_VERSION) return undefined;
  if (!isOutcome(data.outcome) || !isId(data.messageId)) return undefined;
  return { outcome: data.outcome, messageId: data.messageId };
}

/** Returns the callback page's message when it belongs to `attemptId`. */
export function readReturnMessage(data: unknown, attemptId: string): PassportOutcome | undefined {
  if (!hasExactKeys(data, RETURN_KEYS)) return undefined;
  if (data.type !== RETURN_MESSAGE_TYPE || data.version !== MESSAGE_VERSION) return undefined;
  if (data.attemptId !== attemptId || !isOutcome(data.outcome)) return undefined;
  return data.outcome;
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const own = Object.keys(value).sort();
  return own.length === keys.length && own.every((key, index) => key === keys[index]);
}
