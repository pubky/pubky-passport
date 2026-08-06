"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  GoogleBackedIdentityActionState,
  PassportIdentityController,
} from "../../../browser/identity/passportIdentity";
import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";
import type { GoogleAccountProfile } from "../../../core/identity/googleAccountProfile";
import { SocialLoginButton } from "./socialLoginButton";
import { GoogleAccessRequest } from "./googleAccessRequest";
import { IdentityLookup } from "./identityLookup";
import { SignInPage } from "./signInPage";
import { SetupProgress } from "./setupProgress";

type OnboardingCompletion = { googleAccount?: GoogleAccountProfile; identity: PubkyPublicIdentity; mode: "created" | "restored" };

function GoogleOnboardingFlow({ controller, onComplete, onSetupStarted }: {
  controller: PassportIdentityController;
  onComplete: (completion: OnboardingCompletion) => void;
  onSetupStarted: () => void;
}) {
  const dispatching = useRef(false);
  const callbacks = useRef({ onComplete, onSetupStarted });
  const [state, setState] = useState<GoogleBackedIdentityActionState>({ stage: "google-authorization", errorCode: null });
  const [failed, setFailed] = useState(false);
  const [authorizationReady, setAuthorizationReady] = useState(false);

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
        const established = completed.result.value;
        const catalog = controller.list();
        const googleAccount = Result.isOk(catalog)
          ? catalog.value.identities.find((candidate) => candidate.id === established.publicIdentity.publicKeyZ32)?.googleAccount
          : undefined;
        callbacks.current.onComplete({
          identity: established.publicIdentity,
          mode: established.establishmentMode,
          ...(googleAccount ? { googleAccount } : {}),
        });
      })
      .catch(() => setFailed(true))
      .finally(() => { dispatching.current = false; });
  }, [controller]);

  useEffect(() => {
    void controller.prepareGoogleAuthorization((nextState) => {
      setState(nextState);
      if (nextState.stage === "google-authorization" && nextState.errorCode === null) setAuthorizationReady(true);
    }).catch(() => setFailed(true));
    return () => { try { controller.disposeGoogleAuthorization(); } catch { /* Controller owns cleanup logging. */ } };
  }, [controller, continueSetup]);

  const signInFailed = failed || (state.stage === "google-authorization" && state.errorCode !== null);
  if (signInFailed) {
    return <GoogleAccessRequest
      onBack={() => { dispatching.current = false; setFailed(false); setState({ stage: "google-authorization", errorCode: null }); }}
      onTryAgain={() => { dispatching.current = false; setFailed(false); continueSetup(); }}
      status="denied"
    />;
  }

  if (state.stage === "requesting-google-authorization") {
    return <GoogleAccessRequest status="pending" />;
  }
  if (state.stage === "establishing-google-backed-identity") {
    if (state.progress === "preparing_secure_identity" || state.progress === "checking_passport_file") {
      return <IdentityLookup />;
    }
    return <SetupProgress progress={state.progress} />;
  }

  return (
    <SignInPage googleSignInControl={(
      <>
        <SocialLoginButton className="w-full" disabled={!authorizationReady} onClick={continueSetup} provider="google">Continue with Google</SocialLoginButton>
      </>
    )} />
  );
}

export { GoogleOnboardingFlow };
export type { OnboardingCompletion };
