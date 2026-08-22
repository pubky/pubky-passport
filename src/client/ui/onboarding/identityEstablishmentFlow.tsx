
"use client";

import type { GoogleIdentityConfiguration } from "../../logic/google-identity/GoogleIdentityController";
import { GoogleAccessScreen } from "./google/googleAccessScreen";
import { GoogleIdentityComplete } from "./google/googleIdentityComplete";
import { GoogleIdentityError } from "./google/googleIdentityError";
import { GoogleIdentityProgress } from "./google/googleIdentityProgress";
import { useGoogleIdentityEstablishment } from "./google/useGoogleIdentityEstablishment";
import { BackButton } from "../shared/backButton";
import { ProviderSignInButton } from "./providerSignInButton";
import { SignInPage } from "./signInPage";

function IdentityEstablishmentFlow({ googleIdentityConfiguration, onBack, onComplete }: {
  googleIdentityConfiguration: GoogleIdentityConfiguration;
  onBack?: () => void;
  onComplete: () => void;
}) {
  const google = useGoogleIdentityEstablishment(googleIdentityConfiguration);
  const view = google.state.view;

  switch (view.status) {
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

export { IdentityEstablishmentFlow };
