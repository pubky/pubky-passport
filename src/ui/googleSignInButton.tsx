"use client";

import { useEffect, useRef, useState } from "react";

import type {
  BrowserIdentityAction,
  BrowserIdentityActionResult,
  BrowserIdentityController,
  GoogleSignInState,
} from "../browser/identity/browserIdentityController";

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
  const [state, setState] = useState<GoogleSignInState>({ stage: "sign-in", error: null });

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
      {!disabled && state.stage === "sign-in" && state.error ? <p className="text-sm text-red-700" role="alert">{state.error}</p> : null}
      {!disabled && state.stage === "sign-in" && state.error ? (
        <button className="rounded border px-3 py-2" onClick={() => controller.retryGoogleSignIn()} type="button">Try again</button>
      ) : null}
    </div>
  );
}
