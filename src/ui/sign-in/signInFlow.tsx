"use client";

import type { PassportIdentityController } from "../../browser/identity/passportIdentity";
import { GoogleAccessScreen } from "../google-sign-in/googleAccessScreen";
import { GoogleIdentityComplete } from "../google-sign-in/googleIdentityComplete";
import { GoogleIdentityProgress } from "../google-sign-in/googleIdentityProgress";
import { useGoogleSignIn } from "../google-sign-in/useGoogleSignIn";
import { ProviderSignInButton } from "./providerSignInButton";
import { SignInPage } from "./signInPage";

function SignInFlow({ controller, onComplete, onSetupStarted }: {
  controller: PassportIdentityController;
  onComplete: () => void;
  onSetupStarted: () => void;
}) {
  const google = useGoogleSignIn({ controller, onSetupStarted });

  if (google.status === "complete") {
    return <GoogleIdentityComplete
      {...(google.googleAccount ? { googleAccount: google.googleAccount } : {})}
      identity={google.identity}
      mode={google.mode}
      onContinue={onComplete}
    />;
  }

  if (google.status === "requesting-access") return <GoogleAccessScreen status="pending" />;
  if (google.status === "denied") {
    return <GoogleAccessScreen onBack={google.back} onTryAgain={google.tryAgain} status="denied" />;
  }
  if (google.status === "working") return <GoogleIdentityProgress progress={google.progress} />;

  return (
    <SignInPage>
      <ProviderSignInButton
        className="w-full"
        disabled={!google.ready}
        onClick={google.start}
        provider="google"
      >Continue with Google</ProviderSignInButton>
      <ProviderSignInButton disabled provider="apple">Continue with Apple</ProviderSignInButton>
    </SignInPage>
  );
}

export { SignInFlow };
