"use client";

import { useEffect, useRef, useState } from "react";

import type {
  BrowserIdentityAction,
  BrowserIdentityActionResult,
  BrowserIdentityController,
  GoogleSignInErrorCode,
  GoogleSignInState,
} from "../browser/identity/browserIdentityController";

const googleSignInErrorMessages: Record<GoogleSignInErrorCode, string> = {
  sign_in_unavailable: "Google sign-in is unavailable. Try again.",
  sign_in_failed: "Google sign-in did not return an identity. Try again.",
  drive_consent_failed: "Google Drive permission was not granted. Try again.",
  drive_popup_closed: "The Google Drive window was closed. Try again.",
  drive_popup_failed_to_open: "The Google Drive window could not open. Check popup blocking and try again.",
  drive_consent_timeout: "Google Drive permission timed out. Try again.",
  drive_account_mismatch: "Choose the same Google account for sign-in and Drive, then try again.",
  drive_account_verification_failed: "Google Drive account verification is unavailable. Check your connection and try again.",
};

export function GoogleSignInButton({
  controller,
  action,
  disabled,
  onActionCompleted,
  onBusyChange,
}: {
  controller: BrowserIdentityController;
  action: BrowserIdentityAction;
  disabled: boolean;
  onActionCompleted: (result: BrowserIdentityActionResult) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onActionCompleted, onBusyChange });
  const [state, setState] = useState<GoogleSignInState>({ stage: "sign-in", errorCode: null });

  useEffect(() => {
    callbacks.current = { onActionCompleted, onBusyChange };
  }, [onActionCompleted, onBusyChange]);

  useEffect(() => {
    if (!container.current) return;
    void controller.mountGoogleSignIn(container.current, setState);
    return () => controller.unmountGoogleSignIn();
  }, [controller]);

  useEffect(() => {
    callbacks.current.onBusyChange(state.stage === "submitting");
  }, [state.stage]);

  async function continueWithGoogle(): Promise<void> {
    const completed = await controller.continueGoogle(action);
    if (completed.status === "action_completed") callbacks.current.onActionCompleted(completed.result);
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className={state.stage === "sign-in" && !disabled ? undefined : "hidden"} ref={container} />
      {disabled || state.stage === "submitting" ? (
        <p aria-live="polite" className="text-sm text-neutral-600" role="status">Connecting your Google identity.</p>
      ) : null}
      {!disabled && state.stage === "drive" ? (
        <button className="rounded border px-3 py-2" onClick={() => void continueWithGoogle()} type="button">Allow Drive access</button>
      ) : null}
      {!disabled && state.stage === "sign-in" && state.errorCode ? <p className="text-sm text-red-700" role="alert">{googleSignInErrorMessages[state.errorCode]}</p> : null}
      {!disabled && state.stage === "sign-in" && state.errorCode ? (
        <button className="rounded border px-3 py-2" onClick={() => controller.retryGoogleSignIn()} type="button">Try again</button>
      ) : null}
    </div>
  );
}
