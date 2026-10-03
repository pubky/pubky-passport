import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import { isRequestPending } from "@/client/logic/authorization/flow/pendingRequestPresence";
import { RequestContextBand } from "@/client/ui/shared/requestContextBand";
import { useAuthorizationRequester } from "./useAuthorizationRequester";
import { CallbackOriginWarning } from "./callbackOriginWarning";

/**
 * Names who a request comes from, while it waits and on the outcome that ends it: the opener a v2
 * hello bound to this request (A39), else the validated callback host. The app-chosen `xSource`
 * label is never shown here: it is a signal, not an origin, so a request naming neither gets no
 * band.
 */
function SignInBand({ authorization }: { authorization: PassportAuthorizationViewState }) {
  const review = "review" in authorization ? authorization.review : undefined;
  const { requester, callbackWarning } = useAuthorizationRequester(review);
  if (!review || !requester) return null;
  return (
    <RequestContextBand
      label={isRequestPending(authorization) ? "Signing in to" : "Sign-in request from"}
      requester={requester}
      notice={callbackWarning ? <CallbackOriginWarning warning={callbackWarning} /> : undefined}
    />
  );
}

export { SignInBand };
