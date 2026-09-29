import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { DeepLinkLauncher } from "@/client/logic/universal-signer/deepLinkLauncher";
import { BroadAccessWarning } from "@/client/ui/authorization/broadAccessWarning";
import { describeRequester } from "@/client/ui/authorization/requestHeading";
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
 * the link did not open Ring. Passport cannot see Ring's approval, so "I approved" only hands the
 * person back to the app; it stays secondary while Ring is still opening, when no approval can
 * have happened yet. The app, not Passport, waits for the approval, so the status line has no
 * spinner and says what follows it.
 */
export function RingSignIn({
  getAuthorizationUrl,
  launcher,
  onApproved,
  onBack,
  review,
}: {
  getAuthorizationUrl: () => string | undefined;
  launcher: DeepLinkLauncher | undefined;
  onApproved: () => void;
  onBack: () => void;
  review: AuthorizationRequestReview;
}) {
  const mode = useRingHandoffMode();
  const [launch, handoffLauncher] = useDeepLinkLauncher(launcher);
  const scanning = mode === "scan" || launch === "failed";
  const approvalPossible = scanning || launch === "opened";
  const { requester } = describeRequester(review);
  return (
    <RingHandoffScreen
      action="Sign in with"
      instruction={
        scanning
          ? `Scan this code with Pubky Ring on ${mode === "scan" ? "your" : "another"} phone, then choose an identity and approve the sign-in to ${requester}.`
          : `Choose an identity in Pubky Ring and approve the sign-in to ${requester}.`
      }
      navigation={
        <PassportNavigation
          back={<BackButton onClick={onBack} />}
          confirm={
            <Button
              className="w-full"
              onClick={onApproved}
              size="lg"
              variant={approvalPossible ? "default" : "secondary"}
            >
              <CheckIcon />I approved in Pubky Ring
            </Button>
          }
        />
      }
      status={
        <RingHandoffStatus>
          Once you approve in Pubky Ring, {requester} signs you in.
        </RingHandoffStatus>
      }
    >
      <BroadAccessWarning capabilities={review.capabilities} />
      <ExternalSignerRequest getAuthorizationUrl={getAuthorizationUrl} launcher={handoffLauncher} />
    </RingHandoffScreen>
  );
}
