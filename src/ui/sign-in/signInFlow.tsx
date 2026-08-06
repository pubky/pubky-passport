"use client";

import { useState } from "react";

import type { PassportIdentityController } from "../../browser/identity/passportIdentity";
import { CreateOrRestoreGoogleIdentity } from "../create-or-restore-google/createOrRestoreGoogleIdentity";
import { SetupComplete } from "../create-or-restore-google/setupComplete";
import {
  useCreateOrRestoreGoogleIdentity,
  type CreateOrRestoreGoogleIdentityCompletion,
} from "../create-or-restore-google/useCreateOrRestoreGoogleIdentity";
import { ProviderSignInButton } from "./providerSignInButton";
import { SignInPage } from "./signInPage";

function SignInFlow({ controller, onComplete, onSetupStarted }: {
  controller: PassportIdentityController;
  onComplete: () => void;
  onSetupStarted: () => void;
}) {
  const [activeProvider, setActiveProvider] = useState<"google" | null>(null);
  const [completion, setCompletion] = useState<CreateOrRestoreGoogleIdentityCompletion | null>(null);
  const google = useCreateOrRestoreGoogleIdentity({ controller, onComplete: setCompletion, onSetupStarted });

  if (completion) {
    return <SetupComplete
      {...(completion.googleAccount ? { googleAccount: completion.googleAccount } : {})}
      identity={completion.identity}
      mode={completion.mode}
      onContinue={onComplete}
    />;
  }

  if (activeProvider === null && google.status !== "access-denied") {
    return (
      <SignInPage>
        <ProviderSignInButton
          className="w-full"
          disabled={google.status !== "ready" || !google.ready}
          onClick={() => {
            if (google.status !== "ready") return;
            google.start();
            setActiveProvider("google");
          }}
          provider="google"
        >Continue with Google</ProviderSignInButton>
        <ProviderSignInButton disabled provider="apple">Continue with Apple</ProviderSignInButton>
      </SignInPage>
    );
  }

  return <CreateOrRestoreGoogleIdentity
    onBack={() => {
      if (google.status === "access-denied") google.back();
      setActiveProvider(null);
    }}
    state={google}
  />;
}

export { SignInFlow };
