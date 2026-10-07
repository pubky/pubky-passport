import { useCallback, useEffect, useReducer, useSyncExternalStore } from "react";
import {
  OPENER_KEYCHAIN_FEATURE,
  takeOpenerChannel,
} from "@/client/logic/authorization/opener/OpenerChannel";
import {
  describeAuthorizationRequester,
  verifiedOwnHost,
} from "@/client/logic/authorization/opener/describeAuthorizationRequester";
import { describeCallbackWarning } from "@/client/logic/authorization/opener/describeCallbackWarning";
import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";

/**
 * Follows the document binding, including a hello received after the review appeared. M3: only a
 * bound opener verifies who asks; until a hello binds this request, or while one may still come,
 * the request's own claims (callback host, `x-source`) name nobody.
 */
export function useAuthorizationRequester(review?: AuthorizationRequestReview) {
  const channel = takeOpenerChannel();
  const subscribe = useCallback(
    (listener: () => void) => channel?.subscribe(listener) ?? (() => undefined),
    [channel],
  );
  const getSnapshot = useCallback(() => channel?.verifiedOpener(), [channel]);
  const opener = useSyncExternalStore(subscribe, getSnapshot, () => undefined);
  // A popup's hello usually binds within a few hundred milliseconds of the page loading.
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const graceRemaining = opener ? 0 : (channel?.helloGraceRemaining() ?? 0);
  const awaitingHello = graceRemaining > 0;
  useEffect(() => {
    if (!awaitingHello) return;
    const timer = setTimeout(refresh, graceRemaining);
    return () => clearTimeout(timer);
  }, [awaitingHello, graceRemaining]);
  return {
    /** The bound opener's host: the only requester Passport names. */
    requester: describeAuthorizationRequester(opener)?.label,
    /** A v2 hello bound this request to its opener, whose origin the browser reported. */
    bound: opener !== undefined,
    /** The page has an opener whose request-bound hello may still arrive (A39 grace). */
    awaitingHello,
    /** The bound app offers its own keychain route (its hello's `keychain` feature). */
    appOffersKeychain: opener?.features.includes(OPENER_KEYCHAIN_FEATURE) === true,
    /** Nobody verifies who asks: no hello bound this request, and none can still arrive. */
    unverified: opener === undefined && !awaitingHello,
    /** The host whose folder is the app's own (see `verifiedOwnHost`). */
    ownHost: verifiedOwnHost(review, opener),
    callbackWarning: describeCallbackWarning(review, opener),
  };
}
