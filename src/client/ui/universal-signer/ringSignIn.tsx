import { type ReactNode, useEffect, useEffectEvent } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { DeepLinkLauncher } from "@/client/logic/universal-signer/deepLinkLauncher";
import { BroadAccessWarning } from "@/client/ui/authorization/broadAccessWarning";
import { describeRequester, NoWebsiteNotice } from "@/client/ui/authorization/requestHeading";
import { BackButton } from "@/client/ui/shared/backButton";
import { CheckIcon } from "@/client/ui/shared/icons";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Button } from "@/client/ui/shared/primitives/button";
import { RingHandoffScreen, RingHandoffStatus } from "@/client/ui/shared/ringHandoffScreen";
import { useDeepLinkLauncher, useRingHandoffMode } from "@/client/ui/shared/useRingHandoff";
import { ExternalSignerRequest } from "./externalSignerRequest";

/**
 * Hands an app's request to Pubky Ring unchanged: a phone follows the deep link (already followed
 * by the button that opened this screen), a computer scans the QR code, and so does a phone once
 * the link did not open Ring. With `watchApproval`, Passport watches the app's relay channel while
 * this screen is shown and goes on by itself once Ring's answer is there for the app; the status
 * line then spins and says so. "I approved" does the same by hand and stays as the fallback (for a
 * relay Passport cannot watch, or an answer it missed): secondary while Passport watches, and while
 * Ring is still opening, when no approval can have happened yet. Either way Passport only hands the
 * person back to the app, which finishes the sign-in itself.
 *
 * The app is named as the review names it: its label with the website beside it when the two
 * differ. A request that names no website is never named after its own label here either; the copy
 * says "the app" and the same notice as under the review's heading says so.
 */
export function RingSignIn({
  getAuthorizationUrl,
  launcher,
  onApproved,
  onBack,
  review,
  watchApproval,
}: {
  getAuthorizationUrl: () => string | undefined;
  launcher: DeepLinkLauncher | undefined;
  onApproved: () => void;
  onBack: () => void;
  review: AuthorizationRequestReview;
  /** Starts watching for the app to take Ring's answer and returns a function that stops. */
  watchApproval?: (() => () => void) | undefined;
}) {
  const mode = useRingHandoffMode();
  const [launch, handoffLauncher] = useDeepLinkLauncher(launcher);
  const scanning = mode === "scan" || launch === "failed";
  const approvalPossible = scanning || launch === "opened";
  const requester = ringRequester(review);
  const watching = watchApproval !== undefined;
  const startWatching = useEffectEvent(() => watchApproval?.());
  // Watches only while this screen is shown: Back or any other way out stops it.
  useEffect(() => (watching ? startWatching() : undefined), [watching]);
  return (
    <RingHandoffScreen
      action="Sign in with"
      instruction={
        <>
          {scanning
            ? `Scan this code with Pubky Ring on ${mode === "scan" ? "your" : "another"} phone, then choose an identity and approve the sign-in`
            : "Choose an identity in Pubky Ring and approve the sign-in"}
          {requester ? <> to {requester}</> : null}.
        </>
      }
      navigation={
        <PassportNavigation
          back={<BackButton onClick={onBack} />}
          confirm={
            <Button
              className="w-full"
              onClick={onApproved}
              size="lg"
              variant={approvalPossible && !watching ? "default" : "secondary"}
            >
              <CheckIcon />I approved in Pubky Ring
            </Button>
          }
        />
      }
      status={
        <RingHandoffStatus waiting={watching}>
          {watching ? (
            <>
              Waiting for your approval in Pubky Ring. Passport continues by itself once{" "}
              {requester ?? "the app"} has it.
            </>
          ) : (
            <>Once you approve in Pubky Ring, {requester ?? "the app"} signs you in.</>
          )}
        </RingHandoffStatus>
      }
    >
      {review.callbackHost === undefined ? <NoWebsiteNotice /> : null}
      <BroadAccessWarning capabilities={review.capabilities} />
      <ExternalSignerRequest getAuthorizationUrl={getAuthorizationUrl} launcher={handoffLauncher} />
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
