import type { ReactElement } from "react";
import { preload } from "react-dom";

import { GoogleAccessScreen } from "./google/googleAccessScreen";
import { GoogleIdentityComplete } from "./google/googleIdentityComplete";
import { GoogleIdentityError } from "./google/googleIdentityError";
import { GoogleIdentityProgress } from "./google/googleIdentityProgress";
import { useGoogleIdentityEstablishment } from "./google/useGoogleIdentityEstablishment";
import { BackButton } from "../shared/backButton";
import { ProviderSignInButton } from "./providerSignInButton";
import { SignInBand } from "./signInBand";
import { SignInPage } from "./signInPage";

function IdentityEstablishmentFlow({
  onBack,
  onComplete,
  signInTo,
}: {
  onBack?: () => void;
  onComplete: () => void;
  signInTo?: string;
}) {
  const google = useGoogleIdentityEstablishment();
  const view = google.view;

  if (view.status === "requesting-access" || view.status === "working") {
    preload("/illustrations/checkmark.png", { as: "image" });
  }

  let screen: ReactElement;
  switch (view.status) {
    case "complete":
      screen = (
        <GoogleIdentityComplete
          googleAccount={view.googleAccount}
          identity={view.identity}
          mode={view.mode}
          visibleRecoveryCopyStatus={view.visibleRecoveryCopyStatus}
          onContinue={onComplete}
        />
      );
      break;
    case "requesting-access":
      screen = <GoogleAccessScreen fullWidthAction={Boolean(signInTo)} />;
      break;
    case "failed": {
      screen = (
        <GoogleIdentityError
          error={view.error}
          onBack={google.back}
          onTryAgain={google.establishIdentity}
          {...(view.error.code === "invalid_passport_file" ||
          view.error.code === "invalid_passport_file_delete_failed"
            ? { onReplaceInvalidFile: google.replaceInvalidPassportFile }
            : {})}
        />
      );
      break;
    }
    case "working":
      screen = <GoogleIdentityProgress progress={view.progress} />;
      break;
    case "idle":
      screen = (
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
      break;
  }

  return (
    <>
      {signInTo ? <SignInBand requester={signInTo} /> : null}
      {screen}
    </>
  );
}

export { IdentityEstablishmentFlow };
