import type { AuthorizationRequestReview } from "../request/ValidatedPubkyAuthRequest";
import type { VerifiedOpener } from "./OpenerChannel";

export type CallbackWarning = Readonly<{ callbackHost: string; openerHost: string }>;

/** Callback hosts are canonical and HTTPS-only in the validated request review. */
export function describeCallbackWarning(
  review?: AuthorizationRequestReview,
  opener?: VerifiedOpener,
): CallbackWarning | undefined {
  if (!review?.callbackHost || !opener) return undefined;
  if (`https://${review.callbackHost}` === opener.verifiedOrigin) return undefined;
  return {
    callbackHost: review.callbackHost,
    openerHost: new URL(opener.verifiedOrigin).host,
  };
}
