import { PubkyRingLogo } from "@/client/ui/shared/brand/pubkyRingLogo";
import { PubkyRingStoreBadges } from "@/client/ui/shared/brand/pubkyRingStoreBadges";
import { ArrowRightIcon } from "@/client/ui/shared/icons";
import { OnboardingCard } from "@/client/ui/shared/onboardingCard";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Button } from "@/client/ui/shared/primitives/button";
import { SignupStep } from "./signupStep";
import { BackButton } from "@/client/ui/shared/backButton";

export function RingInstallStep({
  onContinue,
  onBack,
}: {
  onContinue: () => void;
  onBack?: () => void;
}) {
  return (
    <SignupStep
      title="Install"
      accent="Pubky Ring."
      description="A keychain for your identity keys in the Pubky ecosystem."
    >
      <OnboardingCard illustration="/illustrations/keychain.png">
        <PubkyRingLogo />
        <p className="text-base leading-6 text-secondary-foreground">
          Download and install the mobile app. Then continue to the next step.
        </p>
        <PubkyRingStoreBadges />
      </OnboardingCard>
      <RingKeychainNote />
      <PassportNavigation
        back={onBack ? <BackButton onClick={onBack} /> : undefined}
        className="mt-auto md:mt-0"
        confirm={
          <Button className="w-full" size="lg" onClick={onContinue}>
            <ArrowRightIcon />
            Continue with Pubky Ring
          </Button>
        }
      />
    </SignupStep>
  );
}

function RingKeychainNote() {
  return (
    <p className="text-sm leading-5 text-muted-foreground">
      Use{" "}
      <a
        className="text-brand underline underline-offset-2"
        href="https://pubkyring.app/"
        target="_blank"
        rel="noreferrer"
      >
        Pubky Ring
      </a>{" "}
      or any{" "}
      <a
        className="text-brand underline underline-offset-2"
        href="https://pubky.org"
        target="_blank"
        rel="noreferrer"
      >
        Pubky Protocol
      </a>
      –based keychain.
    </p>
  );
}
