
"use client";

import type { PassportIdentityController } from "../../browser/identity/passportIdentity";
import { GoogleAccessScreen } from "./google/googleAccessScreen";
import { GoogleIdentityComplete } from "./google/googleIdentityComplete";
import { GoogleIdentityError } from "./google/googleIdentityError";
import { GoogleIdentityProgress } from "./google/googleIdentityProgress";
import { useGoogleSignIn } from "./google/useGoogleSignIn";
import { BackButton } from "../shared/navigation/backButton";
import { ProviderSignInButton } from "./providerSignInButton";
import { SignInPage } from "./signInPage";

function SignInFlow({ controller, onBack, onComplete }: {
  controller: PassportIdentityController;
  onBack?: () => void;
  onComplete: () => void;
}) {
  const google = useGoogleSignIn(controller);
  const view = google.state.view;

  if (view.name === "complete") {
    return <GoogleIdentityComplete
      {...(view.googleAccount ? { googleAccount: view.googleAccount } : {})}
      identity={view.identity}
      mode={view.mode}
      onContinue={onComplete}
    />;
  }

  if (view.name === "requesting-access") return <GoogleAccessScreen status="pending" />;
  if (view.name === "denied") {
    return <GoogleAccessScreen onBack={google.back} onTryAgain={google.retry} status="denied" />;
  }
  if (view.name === "failed") {
    return <GoogleIdentityError
      error={view.error}
      onBack={google.back}
      onReplace={view.error.recovery ? () => google.replaceIncompleteBackup(view.error) : null}
      onTryAgain={google.retry}
    />;
  }
  if (view.name === "working") return <GoogleIdentityProgress progress={view.progress} />;

  return (
    <SignInPage>
      <ProviderSignInButton
        className="w-full"
        disabled={!google.state.authorizationReady}
        onClick={google.start}
        provider="google"
      >Continue with Google</ProviderSignInButton>
      <ProviderSignInButton disabled provider="apple">Continue with Apple</ProviderSignInButton>
      {onBack ? <BackButton onClick={onBack} /> : null}
    </SignInPage>
  );
}

export { SignInFlow };
