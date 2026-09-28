import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";

import type { HomeserverSignupDetails } from "@/client/logic/signup/homeserverInvite";
import { ringSignupUrl } from "@/client/logic/signup/ringSignup";
import { BackButton } from "@/client/ui/shared/backButton";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { PubkyRingLogo } from "@/client/ui/shared/brand/pubkyRingLogo";
import { ArrowRightIcon, ScanIcon } from "@/client/ui/shared/icons";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Button, ButtonLink } from "@/client/ui/shared/primitives/button";
import { RingInstallStep } from "./ringInstallStep";
import { SignupStep } from "./signupStep";
import { RingProfileConnection } from "@/client/ui/profile/ringProfileConnection";
import type { RingProfileControllerPort } from "@/client/ui/passportCollaborators";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";

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
  const [showQr, setShowQr] = useState(false);
  const url = ringSignupUrl(invite);

  if (step === "install")
    return <RingInstallStep onBack={() => setStep("scan")} onContinue={() => setStep("scan")} />;
  if (step === "profile")
    return (
      <RingProfileConnection
        controller={profileController}
        setupRequired
        confirmIdentity
        onBack={inviteUsed ? onBack : () => setStep("scan")}
        onComplete={onComplete}
      />
    );

  return (
    <SignupStep
      title="Scan"
      mobileTitle="Tap to"
      accent="QR Code."
      mobileAccent="Authorize."
      description={
        <>
          <span className="hidden md:inline">
            Open Pubky Ring, tap ‘Add Pubky’, then ‘Scan signup QR’ to create your account.
          </span>
          <span className="md:hidden">
            Tap the button to open Pubky Ring and create your account.
          </span>
        </>
      }
    >
      <section
        className={`${showQr ? "flex" : "hidden md:flex"} items-center justify-center gap-8 rounded-lg bg-card p-6 md:p-8`}
      >
        <Image
          alt=""
          aria-hidden="true"
          src="/illustrations/scan.png"
          width={176}
          height={176}
          className="hidden size-44 shrink-0 object-contain md:block"
        />
        <div className="flex max-w-full shrink-0 items-center justify-center rounded-lg bg-white">
          <QRCodeSVG
            aria-label="Pubky Ring signup QR code"
            role="img"
            value={url}
            className="h-auto max-w-full"
            size={280}
            level="M"
            marginSize={4}
          />
        </div>
      </section>
      <section className="flex flex-col gap-6 rounded-lg bg-card px-6 pb-6 pt-12 md:hidden">
        <PubkyRingLogo />
        <p className="text-base leading-6 text-secondary-foreground">
          Pubky Ring is a mobile keychain that enables you to securely authorize web services and
          apps.
        </p>
        <ButtonLink className="w-full" href={url} size="lg" variant="secondary">
          <PubkyBrandIcon />
          Continue with Pubky Ring
        </ButtonLink>
        <Button variant="ghost" className="w-full" onClick={() => setShowQr(!showQr)}>
          <ScanIcon />
          {showQr ? "Hide signup QR" : "Show signup QR"}
        </Button>
      </section>
      <Button variant="ghost" className="self-start" onClick={() => setStep("install")}>
        Install Pubky Ring
      </Button>
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
      />
    </SignupStep>
  );
}
