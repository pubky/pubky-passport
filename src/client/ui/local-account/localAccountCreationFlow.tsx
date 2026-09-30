"use client";

import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import { backupFileName } from "@/client/logic/backup/BackupVerifier";
import type { HomeserverSignupDetails } from "@/client/logic/signup/homeserverInvite";
import type {
  LocalAccountRegistrationProgress,
  LocalAccountSetupController,
  LocalAccountSetupErrorCode,
} from "@/client/logic/local-account/LocalAccountSetupController";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { BackupFlow } from "@/client/ui/backup/backupFlow";
import { BackButton } from "@/client/ui/shared/backButton";
import { ConfirmDeletionDialog } from "@/client/ui/shared/confirmDeletionDialog";
import { PUBKY_COPY_TOASTS } from "@/client/ui/shared/copyToClipboard";
import { DetailField } from "@/client/ui/shared/detailField";
import { ErrorScreen } from "@/client/ui/shared/errorScreen";
import { ArrowRightIcon, RotateCcwIcon, TrashIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { RecoveryScreen } from "@/client/ui/shared/recoveryScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { Spinner } from "@/client/ui/shared/primitives/spinner";
import {
  IdentityProgress,
  progressSteps,
  SETUP_LIST_LABEL,
  SETUP_STEP,
} from "@/client/ui/shared/identityProgress";

const REGISTRATION_STEP_INDEX = { signing_up: 1, publishing: 2, activating: 3 } satisfies Record<
  LocalAccountRegistrationProgress,
  number
>;

type Step = "password" | "confirm" | "registering" | "failed";
/**
 * Why no key could be prepared: browser storage refused the draft (`storage`), the key could not
 * be created or a saved one restored (`create`), or the code that creates keys did not load
 * (`load`), e.g. offline.
 */
type PreparationFailure = "storage" | "create" | "load";
type PreparedAccount =
  | { status: "loading" }
  | { status: "failed"; reason: PreparationFailure }
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

/**
 * Where the invite came from: a sign-up code Homegate issued after SMS or Lightning verification,
 * or an invite code the person entered. People who verified never saw an invite, so a refused
 * code is described as their verification, and the way on is to verify again.
 */
export type InviteSource = "homegate" | "manual";

/** What went wrong while preparing the key, and the way on; only storage names site data. */
const PREPARATION_FAILURE = {
  // Browsers refuse storage in private windows, when site data is off, or when the disk is full.
  storage: {
    cause:
      "Passport couldn’t prepare a key in this browser. This can happen in a private window, or when site data is blocked or storage is full for this site.",
    nextStep:
      "Allow site data for this site, then try again. Any setup you saved earlier has been kept.",
  },
  create: {
    cause: "Passport couldn’t create a key in this browser.",
    nextStep: "Try again. Any setup you saved earlier has been kept.",
  },
  load: {
    cause: "Passport couldn’t load what it needs to create a key.",
    nextStep: "Check your connection, then try again.",
  },
} satisfies Record<PreparationFailure, { cause: string; nextStep: string }>;

/** Browsers refuse storage in private windows, when site data is off, or when the disk is full. */
const STORAGE_BLOCKED_REMOVAL =
  "Passport couldn’t remove the saved setup because this browser blocked the change. Allow site data for this site, then try again.";

export function LocalAccountCreationFlow({
  invite,
  inviteSource,
  onBack,
  onAbandon,
  onComplete,
  createSetupController = createLocalAccountSetupController,
}: {
  invite: HomeserverSignupDetails;
  /** Decides whether a refused code is described as the person's verification or an invite. */
  inviteSource: InviteSource;
  onBack: () => void;
  /** Called after the draft was removed; the parent should stop resuming this setup. */
  onAbandon?: (reason: LocalAccountAbandonReason) => void;
  onComplete: (identity: LocalIdentityMetadata) => void;
  /** Builds the setup controller; it may load the Pubky SDK first. */
  createSetupController?:
    (() => LocalAccountSetupPort | Promise<LocalAccountSetupPort>) | undefined;
}) {
  const controller = useRef<LocalAccountSetupPort>(null);
  // The factory is a test seam fixed at mount; only the invite decides which draft to prepare.
  const [buildController] = useState(() => createSetupController);
  const [prepared, setPrepared] = useState<PreparedAccount>({ status: "loading" });
  // Counts preparations, so Try again after a failed one builds and prepares a fresh setup.
  const [attempt, setAttempt] = useState(0);
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
    const prepare = (built: LocalAccountSetupPort) => {
      if (!active) {
        built.dispose();
        return;
      }
      setup = built;
      controller.current = built;
      const result = built.prepareAccount(invite);
      publishPrepared(
        Result.isError(result)
          ? {
              status: "failed",
              reason: result.error.code === "storage_failed" ? "storage" : "create",
            }
          : { status: "ready", identity: result.value },
        built.preparedStep,
      );
    };
    const fail = (reason: PreparationFailure) => () =>
      publishPrepared({ status: "failed", reason });
    try {
      const built = buildController();
      // A builder that rejects never delivered the code that creates keys, e.g. offline.
      if (built instanceof Promise) built.then(prepare, fail("load")).catch(fail("create"));
      else prepare(built);
    } catch {
      fail("create")();
    }
    return () => {
      active = false;
      if (controller.current === setup) controller.current = null;
      setup?.dispose();
    };
  }, [attempt, buildController, invite]);

  if (prepared.status === "loading") {
    return (
      <RecoveryScreen
        accent="key."
        description="Preparing the identity saved in this browser."
        title="Preparing your"
      >
        <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" decorative />
          Preparing your pubky…
        </p>
        <PassportNavigation back={<BackButton onClick={onBack} />} />
      </RecoveryScreen>
    );
  }

  if (prepared.status === "failed") {
    return (
      <ErrorScreen
        accent="failed."
        action={
          <Button
            className="w-full"
            onClick={() => {
              setPrepared({ status: "loading" });
              setAttempt((count) => count + 1);
            }}
            size="lg"
          >
            <RotateCcwIcon />
            Try again
          </Button>
        }
        back={<BackButton onClick={onBack} />}
        {...PREPARATION_FAILURE[prepared.reason]}
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
      setAbandonError(STORAGE_BLOCKED_REMOVAL);
    }
  };

  /** Drops the prepared key; after a rejected invite it owns nothing, so no confirmation. */
  const abandonSetup = () => {
    const submitted = controller.current?.hasStartedRegistration === true;
    const abandoned = controller.current?.abandonAccount();
    if (!abandoned || Result.isError(abandoned)) {
      setAbandonError(STORAGE_BLOCKED_REMOVAL);
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
        homeserverPubky={invite.homeserverPubky}
        listLabel={SETUP_LIST_LABEL}
        steps={progressSteps(
          [
            "Download recovery file",
            SETUP_STEP.createAccount,
            SETUP_STEP.publish,
            SETUP_STEP.finish,
          ],
          REGISTRATION_STEP_INDEX[registrationProgress],
        )}
      />
    );
  }

  if (step === "failed") {
    const rejected = failure?.code === "invite_rejected";
    const verified = inviteSource === "homegate";
    return (
      <>
        <ErrorScreen
          accent={rejected ? "not accepted." : "interrupted."}
          action={
            // A refused code has no way back: trying again would resubmit it.
            rejected ? (
              <Button className="w-full" onClick={abandonSetup} size="lg">
                <ArrowRightIcon />
                {verified ? "Verify again" : "Enter a different invite"}
              </Button>
            ) : (
              <Button className="w-full" onClick={() => void registerPreparedAccount()} size="lg">
                <RotateCcwIcon />
                Try again
              </Button>
            )
          }
          cause={
            failure
              ? registrationErrorMessage(failure, inviteSource)
              : "Passport couldn’t finish creating your account."
          }
          details={failure ? { code: failure.code } : undefined}
          nextStep={
            rejected
              ? verified
                ? "No account was created. Verify again to get a new sign-up code."
                : "No account was created with this key. Enter a different invite to continue."
              : "Your recovery file still works. Try again to finish, or start over with a new key."
          }
          secondaryAction={
            rejected ? null : (
              <>
                {/* Where Back used to lead: the file check, which does not leave this setup. */}
                <Button
                  onClick={() => {
                    setFailure(undefined);
                    setAbandonError(undefined);
                    setStep("confirm");
                  }}
                  variant="link"
                >
                  Check recovery file
                </Button>
                <Button
                  onClick={() => {
                    setAbandonError(undefined);
                    if (failure?.registrationStarted === false) discardSetup();
                    else setConfirmingAbandon(true);
                  }}
                  variant="linkDestructive"
                >
                  <TrashIcon />
                  Start over
                </Button>
              </>
            )
          }
          title={rejected ? (verified ? "Verification" : "Invite") : "Setup"}
        >
          {/* A rejected invite leaves a key that owns nothing and is about to be discarded. */}
          {rejected ? null : (
            <DetailField
              copy={{ ...PUBKY_COPY_TOASTS, value: publicKeyZ32 }}
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
          description="This key may already own an account on the homeserver. After removing it from this browser, it can only be restored from the recovery file you downloaded."
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
      backupFileName={backupFileName(publicKeyZ32)}
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

/** What happened, in plain words; the screen's next step says what to do about it. */
function registrationErrorMessage(
  { code, registrationStarted }: RegistrationFailure,
  inviteSource: InviteSource,
): string {
  switch (code) {
    case "controller_unavailable":
      return "Passport lost track of the key it prepared. Go back and start again.";
    case "draft_storage_failed":
      return "Passport couldn’t save your progress in this browser, so nothing was sent. This happens when site data is blocked for this site or the device is out of space. Allow site data (or free up space), then try again.";
    case "homeserver_unreachable":
      // An earlier attempt may have submitted the invite, so the key may already own an account.
      return registrationStarted
        ? "Passport could not reach this invite's homeserver, so this attempt sent nothing. Try again with the same key."
        : "Passport could not reach this invite's homeserver, so nothing was submitted. Try again once it answers.";
    case "storage_failed":
      return "Your account was created, but this browser couldn’t save it. Allow site data for this site (or free up space), then try again.";
    case "signin_failed":
      return "Passport couldn’t confirm your account with the homeserver, so it may or may not have been created yet. Your key is still saved in this browser.";
    case "invite_rejected":
      return inviteSource === "homegate"
        ? "The homeserver didn’t accept the sign-up code your verification gave Passport. It may have expired or already been used."
        : "The homeserver didn’t accept this invite. It may have expired, already been used, or be invalid.";
    default:
      return "Passport couldn’t finish creating your account. The invite may still be valid, so try again with the same key.";
  }
}

/** Loads the setup controller, and with it the Pubky SDK, only once account setup opens. */
async function createLocalAccountSetupController(): Promise<LocalAccountSetupPort> {
  const { LocalAccountSetupController } =
    await import("@/client/logic/local-account/LocalAccountSetupController");
  return new LocalAccountSetupController();
}
