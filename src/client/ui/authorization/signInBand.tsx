import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import { RequestContextBand } from "@/client/ui/shared/requestContextBand";

/**
 * Names the validated callback host of a request. The app-chosen `xSource` label is never shown
 * here: it is a signal, not an origin, so a request without callbacks gets no band.
 */
function SignInBand({ authorization }: { authorization: PassportAuthorizationViewState }) {
  const callbackHost = "review" in authorization ? authorization.review.callbackHost : undefined;
  return callbackHost ? (
    <RequestContextBand label="Signing in to" requester={callbackHost} />
  ) : null;
}

export { SignInBand };
