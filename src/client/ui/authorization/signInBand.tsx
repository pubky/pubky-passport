import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import { isRequestPending } from "@/client/logic/authorization/flow/pendingRequestPresence";
import { RequestContextBand } from "@/client/ui/shared/requestContextBand";
import { useAuthorizationRequester } from "./useAuthorizationRequester";
import { CallbackOriginWarning } from "./callbackOriginWarning";

/**
 * Says who a request comes from, while it waits and on the outcome that ends it: the opener a v2
 * hello bound to this request (A39). M3: without one, Passport cannot tell, and says so; the
 * callback host is only where the request returns to, marked unverified. The app-chosen `xSource`
 * label is never shown here. While a hello may still bind the request there is no band yet.
 */
function SignInBand({ authorization }: { authorization: PassportAuthorizationViewState }) {
  const review = "review" in authorization ? authorization.review : undefined;
  const { requester, unverified, callbackWarning } = useAuthorizationRequester(review);
  if (!review) return null;
  if (requester)
    return (
      <RequestContextBand
        label={isRequestPending(authorization) ? "Signing in to" : "Sign-in request from"}
        requester={requester}
        notice={callbackWarning ? <CallbackOriginWarning warning={callbackWarning} /> : undefined}
      />
    );
  if (!unverified) return null;
  return (
    <RequestContextBand
      label="Passport can’t confirm who is asking."
      notice={
        review.callbackHost ? (
          <p className="break-words">
            Returns to <bdi className="font-bold">{review.callbackHost}</bdi> (unverified)
          </p>
        ) : undefined
      }
    />
  );
}

export { SignInBand };
