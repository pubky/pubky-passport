import { useCallback, useEffect, useReducer, useSyncExternalStore } from "react";
import { takeOpenerChannel } from "@/client/logic/authorization/opener/OpenerChannel";
import { describeAuthorizationRequester } from "@/client/logic/authorization/opener/describeAuthorizationRequester";
import { describeCallbackWarning } from "@/client/logic/authorization/opener/describeCallbackWarning";
import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";

/** Follows the document binding, including a hello received after the review appeared. */
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
    requester: describeAuthorizationRequester(review, opener)?.label,
    /** A v2 hello bound this request to its opener, whose origin the browser reported. */
    bound: opener !== undefined,
    /** The page has an opener whose request-bound hello may still arrive (A39 grace). */
    awaitingHello,
    callbackWarning: describeCallbackWarning(review, opener),
  };
}
