/**
 * M3 (A73): what a request says when no v2 hello bound it to its opener (a plain link, the same
 * tab, or a popup whose hello never came), instead of naming who asks.
 */
export const UNVERIFIED_HEADING = { name: "Sign-in request." } as const;
export const UNVERIFIED_BAND = { name: "Passport can’t confirm who is asking." } as const;
export const UNVERIFIED_WARNING = /Passport can’t confirm who sent this request\./u;

/** The line that shows a request's own label as its unverified claim. */
export const NAME_IN_REQUEST = /^Name in the request:/u;

/** That line's full text for `label`. */
export function nameInRequest(label: string): string {
  return `Name in the request: ${label} (unverified)`;
}
