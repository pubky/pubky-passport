/**
 * The only path that accepts an authorization request: `/authorize#d=<encoded pubkyauth URL>`,
 * the v1 integration contract. `/` renders the same signer but forwards requests here, so a
 * request is always reviewed at one address. Without a request, the entry sends the window to
 * `/`, where identity management lives.
 */
export const AUTHORIZATION_ENTRY_PATH = "/authorize";

/**
 * What a request forwarded from `/` carries in place of any query: a valueless `?d=`. The entry
 * still rejects query transport and a query next to a fragment, but the query's contents, which
 * may hold the relay secret, never reach the server a second time.
 */
export const FORWARDED_QUERY = "?d=";

// Regular-expression sources shared by the CSP-hashed parser-time scripts and the bootstrap
// fallback, which must classify a location identically. Interpolate them; never copy them.

/** A fragment returned by Google's implicit flow; the Google parser-time script owns it. */
export const GOOGLE_CREDENTIAL_FRAGMENT_SOURCE = "(?:^|&)(?:access_token|id_token|error)=";

/** Legacy query transport (`?d=`), which the authorization entry rejects. */
export const REQUEST_QUERY_SOURCE = "(?:^\\?|&)d=";

/**
 * Anything in `search + hash` that may carry a request, matched case-insensitively: a `d`
 * parameter (also percent-encoded) in either part, or a bare `pubkyauth:` link.
 */
export const REQUEST_MARKER_SOURCE = "[?#&](?:d|%64)=|pubkyauth(?::|%3a)";
