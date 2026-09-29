import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { HomeserverSignupDetails } from "@/client/logic/signup/homeserverInvite";
import { ringSignupUrl } from "@/client/logic/signup/ringSignup";
import { watchSignupToken } from "@/client/logic/signup/signupTokenWatcher";
import { usePassportCollaborators } from "@/client/ui/passportCollaborators";
import { BackButton } from "@/client/ui/shared/backButton";
import { ArrowRightIcon } from "@/client/ui/shared/icons";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Button } from "@/client/ui/shared/primitives/button";
import { RingHandoff } from "@/client/ui/shared/ringHandoff";
import { RingHandoffScreen, RingHandoffStatus } from "@/client/ui/shared/ringHandoffScreen";
import { ACCOUNT_SETUP_STEPS, SetupProgressProvider } from "@/client/ui/shared/setupProgress";
import { useDeepLinkLauncher, useRingHandoffMode } from "@/client/ui/shared/useRingHandoff";
import { RingProfileConnection } from "@/client/ui/profile/ringProfileConnection";
import type { RingProfileControllerPort } from "@/client/ui/passportCollaborators";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";

const SIGNUP_LABELS = {
  section: "Pubky Ring signup",
  qrCode: "Pubky Ring signup QR code",
  open: "Continue with Pubky Ring",
  tooLarge: "This signup is too big for a QR code. Open it in Pubky Ring on this device.",
  unavailable: "This signup is no longer available. Go back and choose your signer again.",
};

/**
 * Hands the invite to Pubky Ring for signup, then connects the new identity's profile. Ring returns
 * nothing from the signup, so Passport watches the invite: once the homeserver reports it used,
 * the profile connection opens by itself, and "Continue to profile" covers a lookup that
 * cannot tell. The person then confirms that the pubky Ring connects is the new one. An invite the
 * homeserver already reports used (`inviteUsed`) skips straight to the profile connection.
 */
export function RingSignupStep({
  invite,
  inviteUsed = false,
  onBack,
  onComplete,
  profileController,
}: {
  invite: HomeserverSignupDetails;
  inviteUsed?: boolean;
  onBack: () => void;
  onComplete: (identity: LocalIdentityMetadata) => void;
  profileController: RingProfileControllerPort;
}) {
  const [step, setStep] = useState<"scan" | "profile">(inviteUsed ? "profile" : "scan");
  // Ring has used the invite, so the signup code is spent and Back leaves the Ring signup.
  const [signedUp, setSignedUp] = useState(inviteUsed);
  const mode = useRingHandoffMode();
  // A phone whose link did not open Ring falls back to the QR code, and the copy follows it.
  const [launch, launcher] = useDeepLinkLauncher();
  const scanning = mode === "scan" || launch === "failed";
  const url = ringSignupUrl(invite);
  const { checkSignupToken } = usePassportCollaborators();
  const { homeserverPubky, signupToken } = invite;
  useEffect(() => {
    if (step !== "scan") return;
    return watchSignupToken({ homeserverPubky, signupToken }, checkSignupToken, () => {
      toast.success("Account created in Pubky Ring");
      setSignedUp(true);
      setStep("profile");
    });
  }, [checkSignupToken, homeserverPubky, signupToken, step]);

  if (step === "profile")
    return (
      // The account exists in Ring by now; connecting it is for the profile, the last step.
      <SetupProgressProvider steps={ACCOUNT_SETUP_STEPS} current={2}>
        <RingProfileConnection
          controller={profileController}
          setupRequired
          confirmIdentity
          onBack={signedUp ? onBack : () => setStep("scan")}
          onComplete={onComplete}
        />
      </SetupProgressProvider>
    );

  return (
    <RingHandoffScreen
      action="Create your account in"
      // The pointer, not the width, decides: a computer scans, a phone opens Ring directly.
      instruction={
        scanning
          ? `Open Pubky Ring on ${mode === "scan" ? "your" : "another"} phone, tap ‘Add Pubky’, then ‘Scan signup QR’.`
          : "Continue in Pubky Ring on this phone to create your account. Your private key stays in Pubky Ring."
      }
      navigation={
        <PassportNavigation
          back={<BackButton onClick={onBack} />}
          confirm={
            // Secondary: Passport notices the signup itself, this only covers a lookup that can't.
            <Button
              className="w-full"
              onClick={() => setStep("profile")}
              size="lg"
              variant="secondary"
            >
              <ArrowRightIcon />
              Continue to profile
            </Button>
          }
        />
      }
      // Passport polls the invite, so the line spins; it also warns of the second approval, which
      // comes as a surprise otherwise: signup alone does not connect.
      status={
        <RingHandoffStatus waiting>
          Waiting for Pubky Ring. It asks you twice: to create the account, then to let Passport
          edit your profile.
        </RingHandoffStatus>
      }
    >
      <RingHandoff labels={SIGNUP_LABELS} launcher={launcher} url={url} />
    </RingHandoffScreen>
  );
}
