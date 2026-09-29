import { useState } from "react";

import type { HomeserverSignupDetails } from "@/client/logic/signup/homeserverInvite";
import { ringSignupUrl } from "@/client/logic/signup/ringSignup";
import { BackButton } from "@/client/ui/shared/backButton";
import { ArrowRightIcon } from "@/client/ui/shared/icons";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Button } from "@/client/ui/shared/primitives/button";
import { RingHandoff } from "@/client/ui/shared/ringHandoff";
import { ACCOUNT_SETUP_STEPS, SetupProgressProvider } from "@/client/ui/shared/setupProgress";
import { useDeepLinkLauncher, useRingHandoffMode } from "@/client/ui/shared/useRingHandoff";
import { RingInstallStep } from "./ringInstallStep";
import { SignupStep } from "./signupStep";
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
 * nothing from the signup, so the person confirms that the pubky it connects is the new one. An
 * invite the homeserver reports used (`inviteUsed`) skips straight to the profile connection.
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
  const [step, setStep] = useState<"scan" | "install" | "profile">(inviteUsed ? "profile" : "scan");
  const mode = useRingHandoffMode();
  // A phone whose link did not open Ring falls back to the QR code, and the copy follows it.
  const [launch, launcher] = useDeepLinkLauncher();
  const scanning = mode === "scan" || launch === "failed";
  const url = ringSignupUrl(invite);

  if (step === "install")
    return <RingInstallStep onBack={() => setStep("scan")} onContinue={() => setStep("scan")} />;
  if (step === "profile")
    return (
      // The account exists in Ring by now; connecting it is for the profile, the last step.
      <SetupProgressProvider steps={ACCOUNT_SETUP_STEPS} current={2}>
        <RingProfileConnection
          controller={profileController}
          setupRequired
          confirmIdentity
          onBack={inviteUsed ? onBack : () => setStep("scan")}
          onComplete={onComplete}
        />
      </SetupProgressProvider>
    );

  return (
    <SignupStep
      // The pointer, not the width, decides: a computer scans, a phone opens Ring directly.
      title={scanning ? "Scan" : "Tap to"}
      accent={scanning ? "QR Code." : "Authorize."}
      description={
        scanning
          ? `Open Pubky Ring on ${mode === "scan" ? "your" : "another"} phone, tap ‘Add Pubky’, then ‘Scan signup QR’ to create your account.`
          : "Open Pubky Ring to create your account. Pubky Ring is a mobile keychain that lets you securely authorize web services and apps."
      }
    >
      <RingHandoff labels={SIGNUP_LABELS} launcher={launcher} url={url} />
      <p className="text-sm text-muted-foreground">
        After creating your account in Ring, continue here to set up your public profile.
      </p>
      <PassportNavigation
        className="mt-auto md:mt-0"
        back={<BackButton onClick={onBack} />}
        confirm={
          <Button className="w-full" size="lg" onClick={() => setStep("profile")}>
            <ArrowRightIcon />
            Continue to profile
          </Button>
        }
        tertiary={
          <Button onClick={() => setStep("install")} variant="link">
            Install Pubky Ring
          </Button>
        }
      />
    </SignupStep>
  );
}
