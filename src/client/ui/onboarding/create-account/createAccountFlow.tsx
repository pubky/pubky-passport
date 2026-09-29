"use client";

import { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";

import {
  selectedInvite,
  type InviteDestinationErrorCode,
} from "@/client/logic/local-account/InviteDestinationController";
import { releaseFinishedAccount } from "@/client/logic/local-account/unfinishedLocalAccount";
import { invitesOnly, verifiesWithoutInvite } from "@/client/logic/homegate/verificationMethods";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { SignupTokenStatus } from "@/client/logic/pubky/SignupTokenChecker";
import { sameInvite } from "@/client/logic/signup/homeserverInvite";
import { LocalAccountCreationFlow } from "@/client/ui/local-account/localAccountCreationFlow";
import { UnreadableAccountSetup } from "@/client/ui/local-account/unreadableAccountSetup";
import { BackButton } from "@/client/ui/shared/backButton";
import { ConfirmDeletionDialog } from "@/client/ui/shared/confirmDeletionDialog";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { ChoiceCard } from "@/client/ui/shared/choiceCard";
import { ArrowRightIcon, KeyRoundIcon } from "@/client/ui/shared/icons";
import { ACCOUNT_SETUP_STEPS, SetupProgressProvider } from "@/client/ui/shared/setupProgress";
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

export function CreateAccountFlow({ ...props }: Parameters<typeof AccountCreation>[0]) {
  return (
    <SetupProgressProvider steps={ACCOUNT_SETUP_STEPS} current={0}>
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
  // With no SMS or Lightning on this instance, the method list would offer the invite alone, so
  // account creation opens on the invite entry instead of a choice with one option.
  const inviteOnly = invitesOnly(methods);
  const payWithLightning =
    methods.lightning.status === "available" ? () => void signup.createInvoice() : undefined;

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

  const inviteEntry = (
    <InviteCodeStep
      homeserver={inviteHomeserver}
      initialInvite={destinations.manualInvite ?? undefined}
      error={destinationError}
      inviteOnly={inviteOnly}
      // Without a method list to return to, Back leaves account creation.
      onBack={inviteOnly ? onBack : () => destinationController.closeInviteEntry()}
      // Offered only where SMS or Lightning can be used now; otherwise it would lead back to a
      // list with nothing else to choose.
      onChooseAnotherMethod={
        verifiesWithoutInvite(methods) ? () => destinationController.closeInviteEntry() : undefined
      }
      onContinue={(value) => destinationController.submitInvite(value)}
    />
  );
  if (destinations.manualEntry === "open") return inviteEntry;

  if (invite && destinations.destination === "passport") {
    return (
      <SetupProgressProvider steps={ACCOUNT_SETUP_STEPS} current={1}>
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
      <SetupProgressProvider steps={ACCOUNT_SETUP_STEPS} current={1}>
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
      <SetupProgressProvider steps={ACCOUNT_SETUP_STEPS} current={1}>
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
          onLeave={exit}
          inviteSaved={usesHomegateInvite}
          restored={
            destinations.resumedInvite !== null
              ? "setup"
              : recheckInvite
                ? "verification"
                : undefined
          }
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
      if (inviteOnly) return inviteEntry;
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
          refusal={signup.phoneRefusal}
          onBack={signup.back}
          onEdit={signup.clearError}
          onLightning={payWithLightning}
          onSendCode={signup.continueWithPhone}
          onUseInvite={inviteFallback.onUseInvite}
          pending={signup.pending}
        />
      );
    case "code":
      return (
        <SmsCodeStep
          error={signup.error}
          expired={signup.errorCode === "verification_expired"}
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
  onLeave,
  onDiscardInvite,
  inviteSaved,
  restored,
  registrationStarted,
  checkingInvite,
  error,
}: {
  onPassport: () => void | Promise<void>;
  onRing: () => void;
  /** Returns to the invite entry, while the entered invite can still be changed. */
  onBack?: (() => void) | undefined;
  /** Leaves account creation; an unsubmitted key is dropped. */
  onLeave: () => void;
  onDiscardInvite?: (() => void) | undefined;
  /** The invite came from SMS or Lightning verification and is kept for a later visit. */
  inviteSaved: boolean;
  /**
   * What an earlier visit left in this browser: a key whose setup was started (`setup`), or a
   * verification that issued the invite (`verification`).
   */
  restored?: "setup" | "verification" | undefined;
  registrationStarted: boolean;
  checkingInvite: boolean;
  error?: string | undefined;
}) {
  // Both choices wait on the same invite check; only the one pressed shows it.
  const [choice, setChoice] = useState<"ring" | "passport" | null>(null);
  if (choice && !checkingInvite) setChoice(null);
  // The chip also describes the recommended button, so moving between buttons still hears it.
  const recommendationId = useId();
  const welcomeBack = restored ? (
    <Notice tone="info">
      {restored === "setup"
        ? "Welcome back. The setup you started is saved in this browser, so you can pick up where you left off."
        : "Welcome back. Your verification is saved in this browser, so you don’t need to verify again."}
    </Notice>
  ) : null;
  const errorNotice = error ? (
    <Notice focusOnMount tone="error">
      {error}
    </Notice>
  ) : null;
  const back = <BackButton onClick={onBack ?? onLeave} />;

  // Signup was submitted with the key saved in this browser, which may already own the account:
  // only that key can finish it, so there is nothing left to choose.
  if (registrationStarted)
    return (
      <SignupStep
        accent="account."
        description="You started creating an account with a key saved in this browser. Continue to finish it with that key."
        title="Finish your"
      >
        {welcomeBack}
        {errorNotice}
        <PassportNavigation
          back={back}
          confirm={
            <Button
              className="w-full"
              disabled={checkingInvite}
              loading={choice === "passport"}
              onClick={() => {
                setChoice("passport");
                void onPassport();
              }}
              size="lg"
            >
              <ArrowRightIcon />
              Continue
            </Button>
          }
        />
      </SignupStep>
    );

  return (
    // The step column like every setup step, so the stepper, heading and cards share one edge;
    // each card lays itself out for that width.
    <SignupStep
      accent="key live?"
      description="Your key proves this account is yours. Keep it somewhere only you control."
      title="Where should your"
    >
      {welcomeBack}
      <div className="grid gap-6">
        <ChoiceCard
          description="Keep your key on your phone and approve sign-ins there. Needs the Pubky Ring app."
          illustration="/illustrations/keychain.png"
          recommendationId={recommendationId}
          title="Pubky Ring app"
        >
          <Button
            aria-describedby={recommendationId}
            className="w-full"
            onClick={() => {
              setChoice("ring");
              onRing();
            }}
            disabled={checkingInvite}
            loading={choice === "ring"}
            size="lg"
          >
            <PubkyBrandIcon /> {choice === "ring" ? "Checking invite…" : "Keep key in Pubky Ring"}
          </Button>
        </ChoiceCard>
        <ChoiceCard
          description="Passport keeps your key in this browser, and you download an encrypted backup next."
          // Not a key like Ring's keychain: the encrypted backup that comes with this choice.
          illustration="/illustrations/backup-shield.png"
          title="This browser"
        >
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
            <KeyRoundIcon />{" "}
            {choice === "passport" ? "Checking invite…" : "Keep key in this browser"}
          </Button>
        </ChoiceCard>
      </div>
      {errorNotice}
      {inviteSaved && !onBack && !restored ? (
        <p className="text-sm leading-5 text-muted-foreground">
          Your verification stays saved in this browser.
        </p>
      ) : null}
      <PassportNavigation
        // Back, not Cancel: leaving account creation does not answer the app's request.
        back={back}
        tertiary={
          onDiscardInvite ? (
            <Button disabled={checkingInvite} onClick={onDiscardInvite} variant="linkDestructive">
              Discard invite
            </Button>
          ) : undefined
        }
      />
    </SignupStep>
  );
}
