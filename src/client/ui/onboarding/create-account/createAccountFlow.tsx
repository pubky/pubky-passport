"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";

import {
  selectedInvite,
  type InviteDestinationErrorCode,
} from "@/client/logic/local-account/InviteDestinationController";
import { releaseFinishedAccount } from "@/client/logic/local-account/LocalAccountSetupController";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { SignupTokenStatus } from "@/client/logic/pubky/SignupTokenChecker";
import { sameInvite } from "@/client/logic/signup/homeserverInvite";
import { LocalAccountCreationFlow } from "@/client/ui/local-account/localAccountCreationFlow";
import { UnreadableAccountSetup } from "@/client/ui/local-account/unreadableAccountSetup";
import { BackButton } from "@/client/ui/shared/backButton";
import { CancelButton } from "@/client/ui/shared/cancelButton";
import { ConfirmDeletionDialog } from "@/client/ui/shared/confirmDeletionDialog";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { KeyRoundIcon } from "@/client/ui/shared/icons";
import { SetupProgressProvider } from "@/client/ui/shared/setupProgress";
import { VerificationOptions } from "./verificationOptions";
import {
  usePassportCollaborators,
  type RingProfileControllerPort,
} from "@/client/ui/passportCollaborators";
import { Button } from "@/client/ui/shared/primitives/button";
import { Notice } from "@/client/ui/shared/notice";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { useGoogleIdentityConfiguration } from "@/client/ui/googleIdentityConfiguration";
import { useHomegateAvailability } from "@/client/ui/homegateAvailability";
import { usePassportProvider } from "@/client/ui/passportProviderConfiguration";
import { LightningVerification } from "./lightningVerification";
import { RingSignupStep } from "./ringSignupStep";
import { SignupStep } from "./signupStep";
import { InviteCodeStep } from "./inviteCodeStep";
import { PhoneNumberStep, SmsCodeStep } from "./smsVerification";
import { useHomegateSignup } from "./useHomegateSignup";

const SETUP_STEPS = ["Account", "Keys", "Profile"];

export function CreateAccountFlow({ ...props }: Parameters<typeof AccountCreation>[0]) {
  return (
    <SetupProgressProvider steps={SETUP_STEPS} current={0}>
      <AccountCreation {...props} />
    </SetupProgressProvider>
  );
}

/** Bridges this account creation's invite destination controller to React. */
function useInviteDestination() {
  const { createInviteDestinationController, checkSignupToken } = usePassportCollaborators();
  // Reads the unfinished setup once. A saved setup reopens at the signer choice, not its old step.
  const [controller] = useState(() => createInviteDestinationController(checkSignupToken));
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  );
  const getState = useCallback(() => controller.getState(), [controller]);
  const state = useSyncExternalStore(subscribe, getState, getState);
  useEffect(() => () => controller.dispose(), [controller]);
  return [state, controller] as const;
}

function AccountCreation({
  inviteHomeserver,
  onBack,
  ringProfileController,
  onLocalComplete,
}: {
  inviteHomeserver: string;
  onBack: () => void;
  ringProfileController?: RingProfileControllerPort;
  onLocalComplete: (identity: LocalIdentityMetadata) => void;
}) {
  const { createRingProfileController } = usePassportCollaborators();
  const { httpRelay } = usePassportProvider();
  const [profileConnection] = useState(
    () => ringProfileController ?? createRingProfileController(httpRelay),
  );
  const { homegateBaseUrl } = useGoogleIdentityConfiguration();
  const { methods } = useHomegateAvailability();
  const signup = useHomegateSignup(homegateBaseUrl);
  const [destinations, destinationController] = useInviteDestination();
  // A draft left behind by a finished registration would otherwise keep Ring and invite changes
  // blocked while reading as no setup at all.
  useEffect(() => releaseFinishedAccount(), []);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const homegateInvite = signup.view.step === "complete" ? signup.view.invite : null;
  const invite = selectedInvite(destinations, homegateInvite);
  const usesHomegateInvite = Boolean(
    invite && homegateInvite && sameInvite(invite, homegateInvite),
  );
  // An invite restored from an earlier visit may have been shown to Ring meanwhile.
  const recheckInvite =
    usesHomegateInvite && signup.view.step === "complete" && signup.view.restored;
  const inviteUsed = Boolean(
    invite && destinations.usedInvite && sameInvite(invite, destinations.usedInvite),
  );
  const inviteFallback = {
    onUseInvite: () => {
      // Leaving Lightning stops its polling; the invoice is kept for a later return.
      signup.back();
      destinationController.openInviteEntry();
    },
  };
  const destinationError = destinations.error
    ? destinationErrorMessage(destinations.error)
    : undefined;

  /** An account now owns the Homegate invite, so it no longer needs to survive reloads. */
  const complete = (identity: LocalIdentityMetadata) => {
    if (usesHomegateInvite) signup.releaseInvite();
    onLocalComplete(identity);
  };

  /** A used Homegate invite already belongs to an account, so it is not offered again. */
  const releaseIfUsed = (status: SignupTokenStatus | null) => {
    if (status === "used" && usesHomegateInvite) signup.releaseInvite();
  };

  /** A Homegate invite the dropped Passport key spent must not come back from storage. */
  const forgetIfSpent = (status: SignupTokenStatus | null) => {
    if ((status === "used" || status === "not_found") && usesHomegateInvite) signup.forget();
  };

  /** Leaving drops an unsubmitted key; a Homegate invite stays saved for the next visit. */
  const exit = () => {
    destinationController.exit();
    onBack();
  };

  if (destinations.setupUnavailable) {
    return <UnreadableAccountSetup removable={destinations.setupRemovable} onBack={onBack} />;
  }

  if (destinations.manualEntry === "open") {
    return (
      <InviteCodeStep
        homeserver={inviteHomeserver}
        initialInvite={destinations.manualInvite ?? undefined}
        error={destinationError}
        onBack={() => destinationController.closeInviteEntry()}
        onContinue={(value) => destinationController.submitInvite(value)}
      />
    );
  }

  if (invite && destinations.destination === "passport") {
    return (
      <SetupProgressProvider steps={SETUP_STEPS} current={1}>
        <LocalAccountCreationFlow
          invite={invite}
          onBack={() => destinationController.leavePassport()}
          onAbandon={(reason) => {
            const recheck = destinationController.abandonPassport(reason, invite);
            // A rejected invite must not come back from storage either.
            if (reason === "invite_rejected" && usesHomegateInvite) signup.forget();
            void recheck.then(forgetIfSpent);
          }}
          onComplete={complete}
        />
      </SetupProgressProvider>
    );
  }
  if (invite && destinations.destination === "ring") {
    return (
      <SetupProgressProvider steps={SETUP_STEPS} current={1}>
        <RingSignupStep
          invite={invite}
          inviteUsed={inviteUsed}
          onBack={() => destinationController.returnToChoice()}
          profileController={profileConnection}
          onComplete={complete}
        />
      </SetupProgressProvider>
    );
  }
  if (invite) {
    const discardable = usesHomegateInvite && !destinations.registrationStarted;
    return (
      <SetupProgressProvider steps={SETUP_STEPS} current={1}>
        <InviteDestinationChoice
          checkingInvite={destinations.checkingInvite}
          onPassport={() =>
            destinationController.choosePassport(invite, recheckInvite).then(releaseIfUsed)
          }
          onRing={() =>
            void destinationController.chooseRing(invite, recheckInvite).then(releaseIfUsed)
          }
          error={destinationError}
          registrationStarted={destinations.registrationStarted}
          onBack={
            destinations.manualEntry === "submitted" && !destinations.registrationStarted
              ? () => destinationController.openInviteEntry()
              : undefined
          }
          onCancel={exit}
          onDiscardInvite={discardable ? () => setConfirmingDiscard(true) : undefined}
        />
        {discardable ? (
          <ConfirmDeletionDialog
            confirmLabel="Discard invite"
            description="Passport keeps this invite in this browser until an account uses it. After discarding it, a new invite needs another SMS verification or payment."
            id="discard-homegate-invite"
            onCancel={() => setConfirmingDiscard(false)}
            onConfirm={() => {
              setConfirmingDiscard(false);
              if (destinationController.discardInvite()) signup.forget();
            }}
            open={confirmingDiscard}
            title="Discard this invite?"
          />
        ) : null}
      </SetupProgressProvider>
    );
  }

  const view = signup.view;
  switch (view.step) {
    case "choose":
      return (
        <VerificationOptions
          onLightning={() => {
            if (methods.lightning.status === "available") void signup.createInvoice();
          }}
          onSms={() => {
            if (methods.sms.status === "available") signup.chooseSms();
          }}
          onInvite={() => destinationController.openInviteEntry()}
          onBack={onBack}
        />
      );
    case "phone":
      return (
        <PhoneNumberStep
          initialPhoneNumber={view.phoneNumber}
          sentPhoneNumber={signup.sentPhoneNumber}
          error={signup.error}
          onBack={signup.back}
          onSendCode={signup.continueWithPhone}
          pending={signup.pending}
        />
      );
    case "code":
      return (
        <SmsCodeStep
          error={signup.error}
          onBack={signup.back}
          onSendCode={signup.sendSmsCode}
          {...inviteFallback}
          onVerify={signup.verifySmsCode}
          pending={signup.pending}
          phoneNumber={view.phoneNumber}
          resendAt={view.resendAt}
        />
      );
    case "lightning":
      return (
        <LightningVerification
          error={signup.error}
          expired={view.expired}
          invoice={view.invoice}
          onBack={signup.back}
          onCheckPayment={signup.checkPayment}
          onCreateInvoice={signup.createInvoice}
          {...inviteFallback}
          pending={signup.pending}
        />
      );
    case "complete":
      return null;
  }
}

function destinationErrorMessage(code: InviteDestinationErrorCode): string {
  switch (code) {
    case "invite_change_failed":
      return "Passport could not change this invite. Your saved setup has been kept.";
    case "invite_release_failed":
      return "Passport could not release this invite. Your saved setup has been kept.";
    case "invite_used":
      return "Pubky Ring has already used this invite. Continue with Pubky Ring to finish that account, or use a different invite.";
    case "invite_redeemed":
      return "This invite has already been used. Use a different invite to continue.";
    case "invite_not_found":
      return "This homeserver does not recognize this invite. Check the code and homeserver, or use a different invite.";
  }
}

function InviteDestinationChoice({
  onPassport,
  onRing,
  onBack,
  onCancel,
  onDiscardInvite,
  registrationStarted,
  checkingInvite,
  error,
}: {
  onPassport: () => void | Promise<void>;
  onRing: () => void;
  onBack?: (() => void) | undefined;
  onCancel: () => void;
  onDiscardInvite?: (() => void) | undefined;
  registrationStarted: boolean;
  checkingInvite: boolean;
  error?: string | undefined;
}) {
  // Both choices wait on the same invite check; only the one pressed shows it.
  const [choice, setChoice] = useState<"ring" | "passport" | null>(null);
  if (choice && !checkingInvite) setChoice(null);
  return (
    <SignupStep
      accent="your signer."
      description="Choose where the new identity and its private key will live."
      title="Choose"
      wide
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <section
          aria-label="Pubky Ring"
          className="flex min-w-0 flex-col gap-6 rounded-lg bg-card p-6 lg:p-8 xl:flex-row xl:items-center xl:gap-12 xl:p-12"
        >
          <Image
            alt=""
            aria-hidden="true"
            src="/illustrations/identity-keys.png"
            width={192}
            height={192}
            className="hidden size-48 shrink-0 object-contain lg:block"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <h2 className="text-2xl font-bold leading-8">Pubky Ring</h2>
            <p className="mb-3 text-sm leading-5 text-muted-foreground">
              {registrationStarted
                ? "Signup has started with the key saved in Passport. Continue with that key."
                : "Keep your private key in Ring and approve requests from your phone."}
            </p>
            <Button
              className="w-full"
              onClick={() => {
                setChoice("ring");
                onRing();
              }}
              disabled={registrationStarted || checkingInvite}
              loading={choice === "ring"}
              size="lg"
              variant="secondary"
            >
              <PubkyBrandIcon /> {choice === "ring" ? "Checking invite…" : "Use Pubky Ring"}
            </Button>
          </div>
        </section>
        <section
          aria-label="Pubky Passport"
          className="flex min-w-0 flex-col gap-6 rounded-lg bg-card p-6 lg:p-8 xl:flex-row xl:items-center xl:gap-12 xl:p-12"
        >
          <Image
            alt=""
            aria-hidden="true"
            src="/illustrations/backup-shield.png"
            width={192}
            height={192}
            className="hidden size-48 shrink-0 object-contain lg:block"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <h2 className="text-2xl font-bold leading-8">Pubky Passport</h2>
            <p className="mb-3 text-sm leading-5 text-muted-foreground">
              Keep your key in this browser. Download an encrypted backup to keep it safe.
            </p>
            <Button
              className="w-full"
              onClick={() => {
                setChoice("passport");
                void onPassport();
              }}
              disabled={checkingInvite}
              loading={choice === "passport"}
              size="lg"
              variant="secondary"
            >
              <KeyRoundIcon /> {choice === "passport" ? "Checking invite…" : "Keep in Passport"}
            </Button>
          </div>
        </section>
      </div>
      {error ? (
        <Notice focusOnMount tone="error">
          {error}
        </Notice>
      ) : null}
      {onDiscardInvite ? (
        <Button
          className="self-start"
          disabled={checkingInvite}
          onClick={onDiscardInvite}
          variant="ghost"
        >
          Discard invite
        </Button>
      ) : null}
      <PassportNavigation
        back={onBack ? <BackButton onClick={onBack} /> : <CancelButton onClick={onCancel} />}
      />
    </SignupStep>
  );
}
