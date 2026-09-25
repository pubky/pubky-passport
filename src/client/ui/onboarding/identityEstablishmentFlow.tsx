import { useEffect, useRef } from "react";
import { preload } from "react-dom";

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
  onBack,
  onComplete,
}: {
  forAuthorization?: boolean | undefined;
  onBack?: (() => void) | undefined;
  onComplete: () => void;
}) {
  const google = useGoogleIdentityEstablishment();
  const view = google.view;
  const restored = view.status === "complete" && view.mode === "restored";
  const restorationReported = useRef(false);

  // A restored identity needs no confirmation screen: the caller moves straight on.
  useEffect(() => {
    if (!restored) {
      restorationReported.current = false;
      return;
    }
    if (restorationReported.current) return;
    restorationReported.current = true;
    onComplete();
  }, [onComplete, restored]);

  if (view.status === "requesting-access" || view.status === "working") {
    preload("/illustrations/checkmark.png", { as: "image" });
  }

  switch (view.status) {
    case "complete":
      if (view.mode === "restored") return null;
      return (
        <GoogleIdentityComplete
          googleAccount={view.googleAccount}
          identity={view.identity}
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
          onReplaceUndecryptableFile={google.replaceUndecryptablePassportFile}
          onTryAgain={google.establishIdentity}
          onContinueWithoutVisibleBackup={google.continueWithoutVisibleBackup}
        />
      );
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
          >
            Continue with Google
          </ProviderSignInButton>
          {onBack ? <BackButton className="md:mt-auto" onClick={onBack} /> : null}
        </SignInPage>
      );
  }
}

export { IdentityEstablishmentFlow };
