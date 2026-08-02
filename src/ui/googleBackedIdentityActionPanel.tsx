"use client";

import { useEffect, useRef, useState } from "react";

import type {
  GoogleBackedIdentityAction,
  GoogleBackedIdentityActionErrorCode,
  GoogleBackedIdentityActionResult,
  GoogleBackedIdentityActionState,
  GoogleBackedIdentityProgress,
  PassportIdentityController,
} from "../browser/identity/passportIdentity";

const GOOGLE_AUTHORIZATION_ERROR_MESSAGES: Record<GoogleBackedIdentityActionErrorCode, string> = {
  sign_in_unavailable: "Google sign-in is unavailable. Try again.",
  sign_in_failed: "Google sign-in did not return an account. Try again.",
  google_drive_authorization_failed: "Google Drive authorization was not granted. Try again.",
  google_drive_authorization_popup_closed: "The Google Drive authorization window was closed. Try again.",
  google_drive_authorization_popup_failed_to_open: "The Google Drive authorization window could not open. Check popup blocking and try again.",
  google_drive_authorization_timeout: "Google Drive authorization timed out. Try again.",
  google_drive_authorization_account_mismatch: "Choose the same Google account for sign-in and Google Drive authorization, then try again.",
  google_drive_authorization_account_verification_failed: "Google Drive account verification is unavailable. Check your connection and try again.",
};

export function GoogleBackedIdentityActionPanel({
  controller,
  action,
  disabled,
  onActionCompleted,
  onBusyChange,
}: {
  controller: PassportIdentityController;
  action: GoogleBackedIdentityAction;
  disabled: boolean;
  onActionCompleted: (result: GoogleBackedIdentityActionResult) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const driveAuthorizationButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const retryPending = useRef(false);
  const callbacks = useRef({ onActionCompleted, onBusyChange });
  const [state, setState] = useState<GoogleBackedIdentityActionState>({ stage: "google-sign-in", errorCode: null });
  const [boundaryFailed, setBoundaryFailed] = useState(false);

  useEffect(() => {
    callbacks.current = { onActionCompleted, onBusyChange };
  }, [onActionCompleted, onBusyChange]);

  useEffect(() => {
    if (!container.current) return;
    void controller.mountGoogleSignIn(container.current, setState).catch(() => {
      queueMicrotask(() => setBoundaryFailed(true));
    });
    return () => {
      try {
        controller.unmountGoogleSignIn();
      } catch { /* The browser controller owns cleanup logging. */ }
    };
  }, [controller]);

  useEffect(() => {
    try {
      callbacks.current.onBusyChange(
        state.stage === "requesting-google-drive-authorization"
          || state.stage === "establishing-google-backed-identity"
          || state.stage === "deleting-google-drive-passport-file",
      );
    } catch {
      queueMicrotask(() => setBoundaryFailed(true));
    }
  }, [state.stage]);

  useEffect(() => {
    if (state.stage === "google-drive-authorization") driveAuthorizationButton.current?.focus();
    if (state.stage === "google-sign-in" && state.errorCode) retryButton.current?.focus();
    if (state.stage === "google-sign-in" && !state.errorCode && retryPending.current) {
      retryPending.current = false;
      const renderedControl = container.current?.querySelector<HTMLElement>(
        "button, iframe, [href], input, select, textarea, [tabindex]",
      );
      (renderedControl ?? container.current)?.focus();
    }
  }, [state]);

  async function continueWithGoogle(): Promise<void> {
    try {
      const completed = await controller.continueGoogleBackedIdentityAction(action);
      if (completed.status === "action_completed") callbacks.current.onActionCompleted(completed.result);
    } catch {
      setBoundaryFailed(true);
    }
  }

  function retryGoogleSignIn(): void {
    retryPending.current = true;
    try {
      controller.retryGoogleSignIn();
    } catch {
      retryPending.current = false;
      setBoundaryFailed(true);
    }
  }

  const deletingPassportFile = action.kind === "delete_google_drive_passport_file";
  const establishmentProgress = state.stage === "establishing-google-backed-identity"
    ? identityProgressView(state.progress)
    : null;
  const status = state.stage === "establishing-google-backed-identity"
    ? establishmentProgress?.status
    : state.stage === "deleting-google-drive-passport-file"
      ? "Deleting the Google Drive Passport file."
    : state.stage === "requesting-google-drive-authorization"
      ? deletingPassportFile
        ? "Waiting for Google Drive authorization to delete the Passport file."
        : "Waiting for Google Drive authorization to create or restore your Pubky identity."
    : state.stage === "google-drive-authorization"
      ? deletingPassportFile
        ? "Authorize Google Drive to delete the Passport file."
        : "Authorize Google Drive to access your encrypted Passport file."
      : deletingPassportFile
        ? "Sign in with the Google account linked to the Passport file."
        : "Sign in with your Google account to create or restore your Pubky identity.";

  return (
    <div className="flex flex-col items-start gap-2">
      <p aria-atomic="true" aria-live="polite" className="text-sm text-neutral-600" role="status">{status}</p>
      <div
        aria-busy={state.stage === "requesting-google-drive-authorization"
          || state.stage === "establishing-google-backed-identity"
          || state.stage === "deleting-google-drive-passport-file"}
        className="flex flex-col items-start gap-2"
      >
        <div
          aria-label="Google sign-in"
          className={state.stage === "google-sign-in" && !disabled ? undefined : "hidden"}
          ref={container}
          tabIndex={-1}
        />
        {establishmentProgress ? <IdentityProgressList steps={establishmentProgress.steps} /> : null}
        {boundaryFailed ? <p className="text-sm text-red-700" role="alert">Passport could not continue the Google identity action. Try again.</p> : null}
        {!disabled && state.stage === "google-drive-authorization" ? (
          <button className="rounded border px-3 py-2" onClick={() => void continueWithGoogle()} ref={driveAuthorizationButton} type="button">Authorize Google Drive</button>
        ) : null}
        {!disabled && state.stage === "google-sign-in" && state.errorCode ? <p className="text-sm text-red-700" role="alert">{GOOGLE_AUTHORIZATION_ERROR_MESSAGES[state.errorCode]}</p> : null}
        {!disabled && state.stage === "google-sign-in" && state.errorCode ? (
          <button className="rounded border px-3 py-2" onClick={retryGoogleSignIn} ref={retryButton} type="button">Try again</button>
        ) : null}
      </div>
    </div>
  );
}

type ProgressStep = {
  label: string;
  state: "complete" | "active" | "pending";
};

function IdentityProgressList({ steps }: { steps: ProgressStep[] }) {
  return (
    <ol aria-label="Pubky identity setup progress" className="flex flex-col gap-1 text-sm">
      {steps.map((step) => (
        <li className="flex items-center gap-2" data-state={step.state} key={step.label}>
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${step.state === "complete" ? "bg-green-600" : step.state === "active" ? "bg-neutral-900" : "border border-neutral-400"}`}
          />
          <span className={step.state === "pending" ? "text-neutral-500" : undefined}>{step.label}</span>
          <span className="sr-only"> ({step.state})</span>
        </li>
      ))}
    </ol>
  );
}

function identityProgressView(progress: GoogleBackedIdentityProgress): {
  status: string;
  steps: ProgressStep[];
} {
  switch (progress) {
    case "preparing_secure_identity":
      return {
        status: "Preparing secure identity access.",
        steps: stepStates(["Prepare secure identity access"], 0),
      };
    case "checking_passport_file":
      return {
        status: "Checking for your encrypted Passport backup.",
        steps: stepStates(["Check encrypted Passport backup"], 0),
      };
    case "preparing_new_identity":
      return {
        status: "Preparing new identity setup.",
        steps: stepStates(CREATION_STEP_LABELS, null, 0),
      };
    case "creating_identity":
      return {
        status: "Creating your Pubky identity.",
        steps: stepStates(CREATION_STEP_LABELS, 1),
      };
    case "storing_encrypted_identity":
      return {
        status: "Storing your encrypted Passport backup.",
        steps: stepStates(CREATION_STEP_LABELS, 1),
      };
    case "signing_up_to_homeserver":
      return {
        status: "Signing up to your homeserver.",
        steps: stepStates(CREATION_STEP_LABELS, 2),
      };
    case "publishing_discovery":
      return {
        status: "Publishing discovery records.",
        steps: stepStates(CREATION_STEP_LABELS, 3),
      };
    case "activating_created_identity":
      return {
        status: "Activating your Pubky identity.",
        steps: stepStates(CREATION_STEP_LABELS, 4),
      };
    case "restoring_identity":
      return {
        status: "Restoring your Pubky identity.",
        steps: stepStates(RESTORE_STEP_LABELS, 1),
      };
    case "activating_restored_identity":
      return {
        status: "Activating your restored Pubky identity.",
        steps: stepStates(RESTORE_STEP_LABELS, 2),
      };
  }
}

const CREATION_STEP_LABELS = [
  "Check encrypted Passport backup",
  "Create and store encrypted identity",
  "Sign up to homeserver",
  "Publish discovery records",
  "Activate identity",
];

const RESTORE_STEP_LABELS = [
  "Check encrypted Passport backup",
  "Restore Pubky identity",
  "Activate identity",
];

function stepStates(
  labels: string[],
  activeIndex: number | null,
  completedThrough = activeIndex === null ? -1 : activeIndex - 1,
): ProgressStep[] {
  return labels.map((label, index) => ({
    label,
    state: index <= completedThrough ? "complete" : index === activeIndex ? "active" : "pending",
  }));
}
