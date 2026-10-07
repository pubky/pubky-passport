import { type ReactNode, useEffect, useEffectEvent } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { DeepLinkLauncher } from "@/client/logic/universal-signer/deepLinkLauncher";
import { BroadAccessWarning } from "@/client/ui/authorization/broadAccessWarning";
import {
  describeRequester,
  UnverifiedRequestNotice,
} from "@/client/ui/authorization/requestHeading";
import { useAuthorizationRequester } from "@/client/ui/authorization/useAuthorizationRequester";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { TEXT_MEASURE } from "@/client/ui/shared/primitives/typography";
import { RingHandoffScreen } from "@/client/ui/shared/ringHandoffScreen";
import { useDeepLinkLauncher, useRingHandoffMode } from "@/client/ui/shared/useRingHandoff";
import { ExternalSignerRequest } from "./externalSignerRequest";

/**
 * Hands an app's request to Pubky Ring unchanged: a phone follows the deep link (already followed
 * by the button that opened this screen) and keeps one button to follow it again, never a code; a
 * computer scans the QR code. Nothing here reports an approval: with `watchApproval`, Passport
 * watches the app's relay channel while this screen is shown and goes on by itself once Ring's
 * answer is there for the app; an app with a verified opener closes this window once its SDK has
 * the Session; otherwise the screen stays, with Back, until the app closes it. Passport only ever
 * hands the person back to the app, which finishes the sign-in itself.
 *
 * The app is named as the review names it: once a v2 hello bound the request to its opener, its
 * label with the website beside it when the two differ. A request nobody verified (M3), or one
 * that names no website, is never named after its own label: the copy says "the app", and the same
 * notice as on the review says Passport cannot tell who sent it.
 */
export function RingSignIn({
  getAuthorizationUrl,
  launcher,
  onBack,
  review,
  watchApproval,
}: {
  getAuthorizationUrl: () => string | undefined;
  launcher: DeepLinkLauncher | undefined;
  onBack: () => void;
  review: AuthorizationRequestReview;
  /** Starts watching for the app to take Ring's answer and returns a function that stops. */
  watchApproval?: (() => () => void) | undefined;
}) {
  const mode = useRingHandoffMode();
  // A39: an opener bound to this request names it, so the notice is not shown for it.
  const opener = useAuthorizationRequester(review);
  const requester = opener.bound ? ringRequester(review) : undefined;
  const [, handoffLauncher] = useDeepLinkLauncher(launcher);
  // Only a computer shows a code; a phone opens Pubky Ring, whatever became of a launch.
  const scanning = mode === "scan";
  const grant = review.authenticationMethod === "grant";
  const watching = watchApproval !== undefined;
  const startWatching = useEffectEvent(() => watchApproval?.());
  // Watches only while this screen is shown: Back or any other way out stops it.
  useEffect(() => (watching ? startWatching() : undefined), [watching]);
  return (
    <RingHandoffScreen
      // A grant request reaches either keychain app; the legacy kind only Pubky Ring, as Bitkit
      // refuses it.
      accent={grant ? "keychain." : "Pubky Ring."}
      action="Sign in with"
      instruction={
        <>
          {scanning
            ? grant
              ? "Scan this code with Pubky Ring or Bitkit on your phone, then choose an identity and approve the sign-in"
              : "Scan this code with Pubky Ring on your phone, then choose an identity and approve the sign-in"
            : grant
              ? "Choose an identity in your keychain app and approve the sign-in"
              : "Choose an identity in Pubky Ring and approve the sign-in"}
          {requester ? <> to {requester}</> : null}.
        </>
      }
      navigation={<PassportNavigation back={<BackButton onClick={onBack} />} />}
    >
      {opener.unverified ? <UnverifiedRequestNotice className={TEXT_MEASURE} /> : null}
      <BroadAccessWarning capabilities={review.capabilities} className={TEXT_MEASURE} />
      <ExternalSignerRequest
        getAuthorizationUrl={getAuthorizationUrl}
        launcher={handoffLauncher}
        purpose={grant ? "app-request" : "app-request-ring"}
      />
    </RingHandoffScreen>
  );
}

/**
 * The app as the Ring hand-off names it, isolated from the sentence around it: its label with the
 * website beside it when the two differ, or `undefined` for a request that names no website.
 */
function ringRequester(review: AuthorizationRequestReview): ReactNode {
  if (review.callbackHost === undefined) return undefined;
  const { requester, labelledHost } = describeRequester(review);
  return labelledHost ? (
    <>
      <bdi>{requester}</bdi> (<bdi>{labelledHost}</bdi>)
    </>
  ) : (
    <bdi>{requester}</bdi>
  );
}
