import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { HomeserverSignupDetails } from "@/client/logic/signup/homeserverInvite";
import { ringSignupUrl } from "@/client/logic/signup/ringSignup";
import { watchSignupToken } from "@/client/logic/signup/signupTokenWatcher";
import { usePassportCollaborators } from "@/client/ui/passportCollaborators";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { RingHandoff } from "@/client/ui/shared/ringHandoff";
import { RingHandoffScreen } from "@/client/ui/shared/ringHandoffScreen";
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
 * the profile connection opens by itself; there is no button to go on by hand. The person then
 * confirms that the pubky Ring connects is the new one. An invite the homeserver already reports
 * used (`inviteUsed`) skips straight to the profile connection.
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
  // The profile step comes only once Ring has used the invite, so its Back leaves the Ring signup:
  // the signup code is spent.
  const [step, setStep] = useState<"scan" | "profile">(inviteUsed ? "profile" : "scan");
  const mode = useRingHandoffMode();
  // Only a computer shows a code; a phone opens Pubky Ring, whatever became of a launch.
  const [, launcher] = useDeepLinkLauncher();
  const scanning = mode === "scan";
  const url = ringSignupUrl(invite);
  const { checkSignupToken } = usePassportCollaborators();
  const { homeserverPubky, signupToken } = invite;
  useEffect(() => {
    if (step !== "scan") return;
    return watchSignupToken({ homeserverPubky, signupToken }, checkSignupToken, () => {
      toast.success("Account created in Pubky Ring");
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
          onBack={onBack}
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
          ? "Open Pubky Ring on your phone, tap ‘Add Pubky’, then ‘Scan signup QR’."
          : "Continue in Pubky Ring on this phone to create your account. Your private key stays in Pubky Ring."
      }
      // Passport notices the signup itself and goes on, so there is no way forward to press.
      navigation={<PassportNavigation back={<BackButton onClick={onBack} />} />}
    >
      <RingHandoff labels={SIGNUP_LABELS} launcher={launcher} url={url} />
    </RingHandoffScreen>
  );
}
