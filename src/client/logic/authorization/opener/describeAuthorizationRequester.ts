import type { AuthorizationRequestReview } from "../request/ValidatedPubkyAuthRequest";
import type { VerifiedOpener } from "./OpenerChannel";

/** Who a request comes from, when Passport knows: never an app-supplied name or ID. */
export type AuthorizationRequester = Readonly<{ label: string }> | undefined;

/**
 * A39: the opener bound to this request by a v2 hello names it (a loopback opener says it is a
 * local development app); otherwise the validated callback host does; otherwise nobody.
 */
export function describeAuthorizationRequester(
  review?: AuthorizationRequestReview,
  opener?: VerifiedOpener,
): AuthorizationRequester {
  if (opener) {
    const origin = new URL(opener.verifiedOrigin);
    return {
      label: origin.protocol === "http:" ? `Local development app (${origin.origin})` : origin.host,
    };
  }
  return review?.callbackHost ? { label: review.callbackHost } : undefined;
}
