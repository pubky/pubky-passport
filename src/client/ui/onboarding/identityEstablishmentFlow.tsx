import { preload } from "react-dom";
import type { ReactNode } from "react";

import { GoogleAccessScreen } from "./google/googleAccessScreen";
import { GoogleIdentityComplete } from "./google/googleIdentityComplete";
import { GoogleIdentityError } from "./google/googleIdentityError";
import { GoogleIdentityProgress } from "./google/googleIdentityProgress";
import { useGoogleIdentityEstablishment } from "./google/useGoogleIdentityEstablishment";
import { BackButton } from "@/client/ui/shared/backButton";
import { ProviderSignInButton } from "./providerSignInButton";
import { SignInPage } from "./signInPage";

function IdentityEstablishmentFlow({
  forAuthorization = false,
  creatingAccount = false,
  signupActions,
  onBack,
  onComplete,
}: {
  forAuthorization?: boolean | undefined;
  creatingAccount?: boolean | undefined;
  signupActions?: ReactNode;
  onBack?: (() => void) | undefined;
  onComplete: () => void;
}) {
  const google = useGoogleIdentityEstablishment();
  const view = google.view;

  if (view.status === "requesting-access" || view.status === "working") {
    preload("/illustrations/checkmark.png", { as: "image" });
  }

  switch (view.status) {
    case "complete":
      return (
        <GoogleIdentityComplete
          googleAccount={view.googleAccount}
          identity={view.identity}
          mode={view.mode}
          visibleRecoveryCopyStatus={view.visibleRecoveryCopyStatus}
          onContinue={onComplete}
        />
      );
    case "requesting-access":
      return <GoogleAccessScreen fullWidthAction={forAuthorization} />;
    case "failed": {
      return (
        <GoogleIdentityError
          error={view.error}
          onBack={google.back}
          onReplaceInvalidFile={google.replaceInvalidPassportFile}
          onTryAgain={google.establishIdentity}
        />
      );
    }
    case "working":
      return <GoogleIdentityProgress progress={view.progress} />;
    case "idle":
      return (
        <SignInPage creatingAccount={creatingAccount}>
          <ProviderSignInButton
            className="w-full"
            onClick={google.establishIdentity}
            provider="google"
          >
            Continue with Google
          </ProviderSignInButton>
          {signupActions}
          {onBack ? <BackButton className="md:mt-auto" onClick={onBack} /> : null}
        </SignInPage>
      );
  }
}

export { IdentityEstablishmentFlow };
