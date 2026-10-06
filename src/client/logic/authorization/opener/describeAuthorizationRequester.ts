import type { AuthorizationRequestReview } from "../request/ValidatedPubkyAuthRequest";
import type { VerifiedOpener } from "./OpenerChannel";

/** Who a request comes from, when Passport knows: never an app-supplied name or ID. */
export type AuthorizationRequester = Readonly<{ label: string }> | undefined;

/**
 * A39: the opener bound to this request by a v2 hello names it (a loopback opener says it is a
 * local development app). M3: nothing else does. A request's callback host and `x-source` label
 * are what the request says about itself, so without a bound opener nobody is named.
 */
export function describeAuthorizationRequester(opener?: VerifiedOpener): AuthorizationRequester {
  if (!opener) return undefined;
  const origin = new URL(opener.verifiedOrigin);
  return {
    label: origin.protocol === "http:" ? `Local development app (${origin.origin})` : origin.host,
  };
}

/**
 * The host whose folder (`/pub/<host>/`) Passport may call the app's own: the request's callback
 * host, only when it is the origin of the opener a v2 hello bound to this request.
 */
export function verifiedOwnHost(
  review?: AuthorizationRequestReview,
  opener?: VerifiedOpener,
): string | undefined {
  if (!opener || !review?.callbackHost) return undefined;
  return `https://${review.callbackHost}` === opener.verifiedOrigin
    ? review.callbackHost
    : undefined;
}
