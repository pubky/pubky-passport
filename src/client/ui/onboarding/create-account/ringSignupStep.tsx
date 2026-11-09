import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { HomeserverSignupDetails } from "@/client/logic/signup/homeserverInvite";
import { ringSignupUrl } from "@/client/logic/signup/ringSignup";
import { watchSignupToken } from "@/client/logic/signup/signupTokenWatcher";
import { usePassportCollaborators } from "@/client/ui/passportCollaborators";
import { BackButton } from "@/client/ui/shared/backButton";
import { KeyRoundIcon } from "@/client/ui/shared/icons";
import { KEYCHAIN_QR_STEPS, KeychainHandoffCard } from "@/client/ui/shared/keychainHandoff";
import { OnboardingScreen } from "@/client/ui/shared/onboardingScreen";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { RingHandoff } from "@/client/ui/shared/ringHandoff";
import { SetupProgressProvider } from "@/client/ui/shared/setupProgress";
import { useDeepLinkLauncher, useRingHandoffMode } from "@/client/ui/shared/useRingHandoff";
import { RingProfileConnection } from "@/client/ui/profile/ringProfileConnection";
import type { RingProfileControllerPort } from "@/client/ui/passportCollaborators";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";

const SIGNUP_LABELS = {
  section: "Keychain signup",
  qrCode: "Keychain signup QR code",
  open: "Authorize & configure",
  opening: "Opening your keychain…",
  tooLarge: "This signup is too big for a QR code. Open it in your keychain app on this device.",
  unavailable: "This signup is no longer available. Go back and choose your keychain again.",
};

/** What to do in the keychain app, for either app: one short list, no per-app steps. */

/**
 * Hands the invite to the person's keychain app (Pubky Ring or Bitkit) for signup, then connects
 * the new identity's profile. A computer shows the signup QR code ("Scan QR with keychain."); a
 * phone opens the app with Authorize & configure ("Authorize with keychain."). The app returns
 * nothing from the signup, so Passport watches the invite: once the homeserver reports it used,
 * the profile connection opens by itself; there is no button to go on by hand. The person then
 * confirms that the pubky the keychain connects is the new one. An invite the homeserver already
 * reports used (`inviteUsed`) skips straight to the profile connection.
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
  // The profile step comes only once the keychain has used the invite, so its Back leaves the
  // signup: the signup code is spent.
  const [step, setStep] = useState<"scan" | "profile">(inviteUsed ? "profile" : "scan");
  const scanning = useRingHandoffMode() === "scan";
  // Only a computer shows a code; a phone opens the keychain, whatever became of a launch.
  const [, launcher] = useDeepLinkLauncher();
  const url = ringSignupUrl(invite);
  const { checkSignupToken } = usePassportCollaborators();
  const { homeserverPubky, signupToken } = invite;
  useEffect(() => {
    if (step !== "scan") return;
    return watchSignupToken({ homeserverPubky, signupToken }, checkSignupToken, () => {
      toast.success("Account created in your keychain");
      setStep("profile");
    });
  }, [checkSignupToken, homeserverPubky, signupToken, step]);

  if (step === "profile")
    return (
      // The account exists in the keychain by now; connecting it is for the profile, the last step.
      <SetupProgressProvider current={2}>
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
    <OnboardingScreen
      accent="with keychain."
      // Passport notices the signup itself and goes on, so there is no way forward to press.
      actions={
        <PassportNavigation back={<BackButton className="max-[30rem]:w-full" onClick={onBack} />} />
      }
      lead={
        // The pointer, not the width, decides: a computer scans, a phone opens the app directly.
        scanning
          ? "Use Pubky Ring or Bitkit and follow the instructions below."
          : "Tap below to open your keychain and automatically configure your pubky."
      }
      title={scanning ? "Scan QR" : "Authorize"}
    >
      <KeychainHandoffCard
        handoff={
          <RingHandoff
            bare
            buttonVariant="secondary"
            labels={SIGNUP_LABELS}
            launcher={launcher}
            openIcon={<KeyRoundIcon />}
            url={url}
          />
        }
        instructions={KEYCHAIN_QR_STEPS}
        label={SIGNUP_LABELS.section}
      />
    </OnboardingScreen>
  );
}
