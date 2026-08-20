
"use client";

import type { GoogleIdentityConfiguration } from "../../logic/google-identity/GoogleIdentityController";
import { GoogleAccessScreen } from "./google/googleAccessScreen";
import { GoogleIdentityComplete } from "./google/googleIdentityComplete";
import { GoogleIdentityError } from "./google/googleIdentityError";
import { GoogleIdentityProgress } from "./google/googleIdentityProgress";
import { useGoogleSignIn } from "./google/useGoogleSignIn";
import { BackButton } from "../shared/navigation/backButton";
import { ProviderSignInButton } from "./providerSignInButton";
import { SignInPage } from "./signInPage";

function SignInFlow({ googleIdentityConfiguration, onBack, onComplete }: {
  googleIdentityConfiguration: GoogleIdentityConfiguration;
  onBack?: () => void;
  onComplete: () => void;
}) {
  const google = useGoogleSignIn(googleIdentityConfiguration);
  const view = google.state.view;

  switch (view.name) {
    case "complete":
      return <GoogleIdentityComplete
        googleAccount={view.googleAccount}
        identity={view.identity}
        mode={view.mode}
        onContinue={onComplete}
      />;
    case "requesting-access":
      return <GoogleAccessScreen status="pending" />;
    case "denied":
      return <GoogleAccessScreen onBack={google.back} onTryAgain={google.establishIdentity} status="denied" />;
    case "failed":
      return <GoogleIdentityError
        error={view.error}
        onBack={google.back}
        onTryAgain={google.establishIdentity}
      />;
    case "working":
      return <GoogleIdentityProgress progress={view.progress} />;
    case "idle":
      return (
        <SignInPage>
          <ProviderSignInButton
            className="w-full"
            disabled={!google.controllerReady}
            onClick={google.establishIdentity}
            provider="google"
          >Continue with Google</ProviderSignInButton>
          <ProviderSignInButton disabled provider="apple">Continue with Apple</ProviderSignInButton>
          {onBack ? <BackButton onClick={onBack} /> : null}
        </SignInPage>
      );
  }
}

export { SignInFlow };
