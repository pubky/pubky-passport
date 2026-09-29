import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import { isRequestPending } from "@/client/logic/authorization/flow/pendingRequestPresence";
import { RequestContextBand } from "@/client/ui/shared/requestContextBand";

/**
 * Names the validated callback host of a request, while it waits and on the outcome that ends it,
 * so no screen of a request leaves the app unnamed. The app-chosen `xSource` label is never shown
 * here: it is a signal, not an origin, so a request without callbacks gets no band.
 */
function SignInBand({ authorization }: { authorization: PassportAuthorizationViewState }) {
  const callbackHost = "review" in authorization ? authorization.review.callbackHost : undefined;
  if (!callbackHost) return null;
  return (
    <RequestContextBand
      label={isRequestPending(authorization) ? "Signing in to" : "Sign-in request from"}
      requester={callbackHost}
    />
  );
}

export { SignInBand };
