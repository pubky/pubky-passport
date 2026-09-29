"use client";

import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import type { HomeserverSignupDetails } from "@/client/logic/signup/homeserverInvite";
import {
  LocalAccountSetupController,
  type LocalAccountRegistrationProgress,
  type LocalAccountSetupErrorCode,
} from "@/client/logic/local-account/LocalAccountSetupController";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { BackupFlow } from "@/client/ui/backup/backupFlow";
import { BackButton } from "@/client/ui/shared/backButton";
import { ConfirmDeletionDialog } from "@/client/ui/shared/confirmDeletionDialog";
import { DetailField } from "@/client/ui/shared/detailField";
import { ErrorScreen } from "@/client/ui/shared/errorScreen";
import { ArrowRightIcon, RotateCcwIcon, TrashIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { RecoveryScreen } from "@/client/ui/shared/recoveryScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { IdentityProgress, progressSteps } from "@/client/ui/shared/identityProgress";

const REGISTRATION_STEP_INDEX = { signing_up: 1, publishing: 2, activating: 3 } satisfies Record<
  LocalAccountRegistrationProgress,
  number
>;

type Step = "password" | "confirm" | "registering" | "failed";
type PreparedAccount =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; identity: LocalIdentityMetadata };
type RegistrationFailure = {
  code: LocalAccountSetupErrorCode | "controller_unavailable";
  /** The invite was submitted at least once, so the key may own an account; true when unknown. */
  registrationStarted: boolean;
};

export type LocalAccountSetupPort = Pick<
  LocalAccountSetupController,
  | "abandonAccount"
  | "createBackup"
  | "discardUnregistered"
  | "dispose"
  | "hasStartedRegistration"
  | "prepareAccount"
  | "preparedStep"
  | "registerAccount"
  | "returnToBackup"
  | "skipVerification"
  | "verifyBackup"
>;

/**
 * Why the prepared key was dropped from this browser: the homeserver rejected its invite, the
 * invite was submitted and may already be redeemed, or it was never submitted.
 */
export type LocalAccountAbandonReason = "invite_rejected" | "invite_submitted" | "user";

export function LocalAccountCreationFlow({
  invite,
  onBack,
  onAbandon,
  onComplete,
  createSetupController = () => new LocalAccountSetupController(),
}: {
  invite: HomeserverSignupDetails;
  onBack: () => void;
  /** Called after the draft was removed; the parent should stop resuming this setup. */
  onAbandon?: (reason: LocalAccountAbandonReason) => void;
  onComplete: (identity: LocalIdentityMetadata) => void;
  createSetupController?: () => LocalAccountSetupPort;
}) {
  const controller = useRef<LocalAccountSetupPort>(null);
  // The factory is a test seam fixed at mount; only the invite decides which draft to prepare.
  const [buildController] = useState(() => createSetupController);
  const [prepared, setPrepared] = useState<PreparedAccount>({ status: "loading" });
  const [step, setStep] = useState<Step>("password");
  const [registrationProgress, setRegistrationProgress] =
    useState<LocalAccountRegistrationProgress>("signing_up");
  const [failure, setFailure] = useState<RegistrationFailure>();
  const [abandonError, setAbandonError] = useState<string>();
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);

  useEffect(() => {
    let active = true;
    let setup: LocalAccountSetupPort | undefined;
    const publishPrepared = (value: PreparedAccount, restoredStep: Step = "password") => {
      queueMicrotask(() => {
        if (active) {
          setPrepared(value);
          setStep(restoredStep);
        }
      });
    };
    try {
      setup = buildController();
      controller.current = setup;
      const result = setup.prepareAccount(invite);
      publishPrepared(
        Result.isError(result) ? { status: "failed" } : { status: "ready", identity: result.value },
        setup.preparedStep,
      );
    } catch {
      publishPrepared({ status: "failed" });
    }
    return () => {
      active = false;
      if (controller.current === setup) controller.current = null;
      setup?.dispose();
    };
  }, [buildController, invite]);

  if (prepared.status === "loading") {
    return (
      <RecoveryScreen
        description="Preparing the identity saved in this browser."
        title="Preparing key…"
      >
        <p aria-live="polite" className="text-sm text-muted-foreground">
          Preparing your Pubky…
        </p>
        <PassportNavigation back={<BackButton onClick={onBack} />} />
      </RecoveryScreen>
    );
  }

  if (prepared.status === "failed") {
    return (
      <ErrorScreen
        accent="failed."
        back={<BackButton onClick={onBack} />}
        cause="Passport could not prepare or restore your saved key."
        nextStep="Go back and try again. Any previously saved setup has been kept."
        title="Setup"
      />
    );
  }

  const publicKeyZ32 = prepared.identity.publicIdentity.publicKeyZ32;

  const registerPreparedAccount = async () => {
    const fail = (code: RegistrationFailure["code"]) => {
      setFailure({
        code,
        registrationStarted: controller.current?.hasStartedRegistration !== false,
      });
      setStep("failed");
    };
    setFailure(undefined);
    setRegistrationProgress("signing_up");
    setStep("registering");
    try {
      const registered = await controller.current?.registerAccount(setRegistrationProgress);
      if (!registered) return fail("controller_unavailable");
      if (Result.isError(registered)) return fail(registered.error.code);
      onComplete(registered.value);
    } catch {
      fail("registration_failed");
    }
  };

  const leaveFlow = () => {
    // Leaving before the invite was submitted forgets the key, so the next visit starts fresh.
    const discarded = controller.current?.discardUnregistered();
    if (discarded && Result.isOk(discarded)) onAbandon?.("user");
    onBack();
  };

  /**
   * Drops a key whose invite was never submitted: it owns no account, so no confirmation. When
   * another tab submitted the invite meanwhile, the confirmation for a possible account opens.
   */
  const discardSetup = () => {
    const discarded = controller.current?.discardUnregistered();
    if (discarded && Result.isOk(discarded)) {
      onAbandon?.("user");
      onBack();
    } else if (discarded?.error.code === "registration_started") {
      setConfirmingAbandon(true);
    } else {
      setAbandonError("Passport could not remove the saved setup. Free some storage and retry.");
    }
  };

  /** Drops the prepared key; after a rejected invite it owns nothing, so no confirmation. */
  const abandonSetup = () => {
    const submitted = controller.current?.hasStartedRegistration === true;
    const abandoned = controller.current?.abandonAccount();
    if (!abandoned || Result.isError(abandoned)) {
      setAbandonError("Passport could not remove the saved setup. Free some storage and retry.");
      return;
    }
    setConfirmingAbandon(false);
    onAbandon?.(abandonReason(failure?.code === "invite_rejected", submitted));
    onBack();
  };

  if (step === "registering") {
    return (
      <IdentityProgress
        heading="Setting up"
        listLabel="Pubky identity setup progress"
        steps={progressSteps(
          [
            "Download encrypted backup",
            "Sign up to the homeserver",
            "Publish PKDNS records",
            "Activate identity",
          ],
          REGISTRATION_STEP_INDEX[registrationProgress],
        )}
      />
    );
  }

  if (step === "failed") {
    const rejected = failure?.code === "invite_rejected";
    return (
      <>
        <ErrorScreen
          accent={rejected ? "rejected." : "interrupted."}
          action={
            // A rejected invite has no way back: verifying again would resubmit it.
            rejected ? (
              <Button className="w-full" onClick={abandonSetup} size="lg">
                <ArrowRightIcon />
                Use another invite
              </Button>
            ) : (
              <Button className="w-full" onClick={() => void registerPreparedAccount()} size="lg">
                <RotateCcwIcon />
                Retry with this key
              </Button>
            )
          }
          back={
            rejected ? undefined : (
              <BackButton
                onClick={() => {
                  setFailure(undefined);
                  setAbandonError(undefined);
                  setStep("confirm");
                }}
              />
            )
          }
          cause={failure ? registrationErrorMessage(failure) : "Registration did not complete."}
          details={failure ? { code: failure.code } : undefined}
          nextStep={
            rejected
              ? "No account was created with this key. Use another invite to continue."
              : "Your downloaded backup is still valid. If retrying does not help, start over with a new key."
          }
          secondaryAction={
            rejected ? null : (
              <Button
                className="text-destructive-text"
                onClick={() => {
                  setAbandonError(undefined);
                  if (failure?.registrationStarted === false) discardSetup();
                  else setConfirmingAbandon(true);
                }}
                variant="ghost"
              >
                <TrashIcon />
                Start over
              </Button>
            )
          }
          title={rejected ? "Invite" : "Setup"}
        >
          {/* A rejected invite leaves a key that owns nothing and is about to be discarded. */}
          {rejected ? null : (
            <DetailField
              copy={{
                value: publicKeyZ32,
                copied: "Pubky copied to clipboard",
                failed: "Could not copy pubky",
                failedDescription: "Select and copy your pubky manually.",
              }}
              label="Your pubky"
              value={publicKeyZ32}
            />
          )}
          {abandonError && !confirmingAbandon ? (
            <Notice focusOnMount tone="error">
              {abandonError}
            </Notice>
          ) : null}
        </ErrorScreen>
        <ConfirmDeletionDialog
          confirmLabel="Remove key and start over"
          description="This key may already own an account on the homeserver. After removing it from this browser, it can only be restored from the backup file you downloaded."
          error={abandonError}
          id="abandon-account-setup"
          onCancel={() => {
            setAbandonError(undefined);
            setConfirmingAbandon(false);
          }}
          onConfirm={abandonSetup}
          open={confirmingAbandon}
          title="Start over?"
        />
      </>
    );
  }

  return (
    <BackupFlow
      key={step}
      creatingAccount
      initialStep={step}
      createBackup={(password) =>
        controller.current?.createBackup(password) ?? Result.err({ code: "create_failed" })
      }
      verifyBackup={(bytes, password) =>
        controller.current?.verifyBackup(bytes, password) ?? Result.err({ code: "create_failed" })
      }
      onReturnToPassword={() =>
        controller.current?.returnToBackup() ?? Result.err({ code: "storage_failed" })
      }
      onBack={leaveFlow}
      onComplete={() => void registerPreparedAccount()}
      onSkip={() => {
        const skipped = controller.current?.skipVerification();
        if (skipped && Result.isOk(skipped)) void registerPreparedAccount();
      }}
    />
  );
}

function abandonReason(rejected: boolean, submitted: boolean): LocalAccountAbandonReason {
  if (rejected) return "invite_rejected";
  return submitted ? "invite_submitted" : "user";
}

function registrationErrorMessage({ code, registrationStarted }: RegistrationFailure): string {
  switch (code) {
    case "controller_unavailable":
      return "Passport lost access to the prepared key. Start again.";
    case "draft_storage_failed":
      return "Passport could not save your progress in this browser, so nothing was submitted. Free some storage and retry.";
    case "homeserver_unreachable":
      // An earlier attempt may have submitted the invite, so the key may already own an account.
      return registrationStarted
        ? "Passport could not reach this invite's homeserver, so this attempt sent nothing. Retry with the same key."
        : "Passport could not reach this invite's homeserver, so nothing was submitted. Retry once it answers.";
    case "storage_failed":
      return "The account was verified, but this browser could not save it. Retry after freeing storage.";
    case "signin_failed":
      return "Account state is uncertain. Retry to reconcile it with the same key.";
    case "invite_rejected":
      return "The homeserver rejected this invite. It may have expired, already been used, or be invalid. Retrying with the same invite will not work.";
    default:
      return "Registration did not complete. The invite may still be valid; retry with the same key.";
  }
}
