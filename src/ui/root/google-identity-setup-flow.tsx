"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  GoogleBackedIdentityActionState,
  PassportIdentityController,
} from "../../browser/identity/passportIdentity";
import type { PubkyPublicIdentity } from "../../core/identity/pubkyIdentity";
import { Button } from "../components/button";
import { SocialLoginButton } from "../components/social-login-button";
import { RootLandingPage } from "./root-landing-page";
import { SetupProgress } from "./setup-progress";

function GoogleIdentitySetupFlow({ controller, onComplete, onSetupStarted }: {
  controller: PassportIdentityController;
  onComplete: (identity: PubkyPublicIdentity) => void;
  onSetupStarted: () => void;
}) {
  const googleButton = useRef<HTMLDivElement>(null);
  const dispatching = useRef(false);
  const callbacks = useRef({ onComplete, onSetupStarted });
  const [state, setState] = useState<GoogleBackedIdentityActionState>({ stage: "google-sign-in", errorCode: null });
  const [failed, setFailed] = useState(false);
  const [mountAttempt, setMountAttempt] = useState(0);

  useEffect(() => { callbacks.current = { onComplete, onSetupStarted }; }, [onComplete, onSetupStarted]);

  const continueSetup = useCallback((): void => {
    if (dispatching.current) return;
    dispatching.current = true;
    callbacks.current.onSetupStarted();
    void controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" })
      .then((completed) => {
        if (completed.status !== "action_completed") return;
        if (Result.isError(completed.result) || completed.result.value.kind !== "google_backed_identity_established") {
          setFailed(true);
          return;
        }
        callbacks.current.onComplete(completed.result.value.publicIdentity);
      })
      .catch(() => setFailed(true))
      .finally(() => { dispatching.current = false; });
  }, [controller]);

  useEffect(() => {
    if (!googleButton.current) return;
    void controller.mountGoogleSignIn(googleButton.current, (nextState) => {
      setState(nextState);
      if (nextState.stage === "google-drive-authorization" && hasTransientUserActivation()) continueSetup();
    }).catch(() => setFailed(true));
    return () => { try { controller.unmountGoogleSignIn(); } catch { /* Controller owns cleanup logging. */ } };
  }, [controller, continueSetup, mountAttempt]);

  const signInFailed = failed || (state.stage === "google-sign-in" && state.errorCode !== null);
  if (signInFailed) {
    return (
      <RootLandingPage googleSignInControl={(
        <div className="flex flex-col gap-3">
          <p className="text-sm text-destructive-foreground" role="alert">Passport could not continue with Google. Try again.</p>
          <Button onClick={() => { dispatching.current = false; setFailed(false); setState({ stage: "google-sign-in", errorCode: null }); setMountAttempt((value) => value + 1); }} size="lg">Try again</Button>
        </div>
      )} />
    );
  }

  if (state.stage === "google-drive-authorization") {
    return <SetupProgress action={<Button className="w-full" onClick={continueSetup} size="lg">Authorize Google Drive</Button>} progress={null} />;
  }
  if (state.stage === "requesting-google-drive-authorization") {
    return <SetupProgress progress={null} />;
  }
  if (state.stage === "establishing-google-backed-identity") {
    return <SetupProgress progress={state.progress} />;
  }

  return (
    <RootLandingPage googleSignInControl={(
      <div className="relative h-[60px] overflow-hidden rounded-full">
        <SocialLoginButton className="pointer-events-none absolute inset-0 w-full" provider="google">Continue with Google</SocialLoginButton>
        <div aria-label="Google sign-in" className="absolute inset-0 z-10 overflow-hidden opacity-[0.001] [&>div]:h-full [&>div]:w-full [&_iframe]:h-full! [&_iframe]:w-full!" ref={googleButton} />
      </div>
    )} />
  );
}

function hasTransientUserActivation(): boolean {
  return typeof navigator !== "undefined" && navigator.userActivation?.isActive === true;
}

export { GoogleIdentitySetupFlow };
