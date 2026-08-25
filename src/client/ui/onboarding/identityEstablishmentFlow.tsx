"use client";

import { preload } from "react-dom";

import { GoogleAccessScreen } from "./google/googleAccessScreen";
import { GoogleIdentityComplete } from "./google/googleIdentityComplete";
import { GoogleIdentityError } from "./google/googleIdentityError";
import { GoogleIdentityProgress } from "./google/googleIdentityProgress";
import { useGoogleIdentityEstablishment } from "./google/useGoogleIdentityEstablishment";
import { BackButton } from "../shared/backButton";
import { ProviderSignInButton } from "./providerSignInButton";
import { SignInPage } from "./signInPage";

function IdentityEstablishmentFlow({ onBack, onComplete }: {
  onBack?: () => void;
  onComplete: () => void;
}) {
  const google = useGoogleIdentityEstablishment();
  const view = google.view;

  if (view.status === "requesting-access" || view.status === "working") {
    preload("/illustrations/checkmark.png", { as: "image" });
  }

  switch (view.status) {
    case "complete":
      return <GoogleIdentityComplete
        googleAccount={view.googleAccount}
        identity={view.identity}
        mode={view.mode}
        visibleRecoveryCopyStatus={view.visibleRecoveryCopyStatus}
        onContinue={onComplete}
      />;
    case "requesting-access":
      return <GoogleAccessScreen />;
    case "failed": {
      return <GoogleIdentityError
        error={view.error}
        onBack={google.back}
        onTryAgain={google.establishIdentity}
        {...(view.error.code === "invalid_passport_file"
          || view.error.code === "invalid_passport_file_delete_failed"
          ? { onReplaceInvalidFile: google.replaceInvalidPassportFile }
          : {})}
      />;
    }
    case "working":
      return <GoogleIdentityProgress progress={view.progress} />;
    case "idle":
      return (
        <SignInPage>
          <ProviderSignInButton
            className="w-full"
            onClick={google.establishIdentity}
            provider="google"
          >Continue with Google</ProviderSignInButton>
          {onBack ? <BackButton onClick={onBack} /> : null}
        </SignInPage>
      );
  }
}

export { IdentityEstablishmentFlow };
