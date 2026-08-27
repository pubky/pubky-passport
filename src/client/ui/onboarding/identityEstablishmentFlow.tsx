import { preload } from "react-dom";

import { GoogleAccessScreen } from "./google/googleAccessScreen";
import { GoogleIdentityComplete } from "./google/googleIdentityComplete";
import { GoogleIdentityError } from "./google/googleIdentityError";
import { GoogleIdentityProgress } from "./google/googleIdentityProgress";
import { useGoogleIdentityEstablishment } from "./google/useGoogleIdentityEstablishment";
import { BackButton } from "../shared/backButton";
import { ProviderSignInButton } from "./providerSignInButton";
import { SignInPage } from "./signInPage";

function IdentityEstablishmentFlow({ onBack, onComplete, signInTo }: {
  onBack?: () => void;
  onComplete: () => void;
  signInTo?: string;
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
        {...(signInTo ? { signInTo } : {})}
      />;
    case "requesting-access":
      return <GoogleAccessScreen {...(signInTo ? { signInTo } : {})} />;
    case "failed": {
      return <GoogleIdentityError
        error={view.error}
        onBack={google.back}
        onTryAgain={google.establishIdentity}
        {...(signInTo ? { signInTo } : {})}
        {...(view.error.code === "invalid_passport_file"
          || view.error.code === "invalid_passport_file_delete_failed"
          ? { onReplaceInvalidFile: google.replaceInvalidPassportFile }
          : {})}
      />;
    }
    case "working":
      return <GoogleIdentityProgress progress={view.progress} {...(signInTo ? { signInTo } : {})} />;
    case "idle":
      return (
        <SignInPage {...(signInTo ? { signInTo } : {})}>
          <ProviderSignInButton
            className="w-full"
            onClick={google.establishIdentity}
            provider="google"
          >Continue with Google</ProviderSignInButton>
          {onBack ? <BackButton className="md:mt-auto" onClick={onBack} /> : null}
        </SignInPage>
      );
  }
}

export { IdentityEstablishmentFlow };
