import { useEffect, useRef } from "react";
import { preload } from "react-dom";

import { isGoogleRedirectReturn } from "@/client/logic/google-identity/gia/googleRedirectBootstrap";
import { useAppleIdentity, type AppleIdentityHandle } from "@/client/ui/useAppleIdentity";
import { AppleIdentityError } from "./apple/appleIdentityError";
import { AppleSignInScreen } from "./apple/appleSignInScreen";
import { ConnectICloudScreen } from "./apple/connectICloudScreen";
import { GoogleAccessScreen } from "./google/googleAccessScreen";
import { GoogleIdentityError } from "./google/googleIdentityError";
import { IdentityComplete } from "./identityComplete";
import { IdentityProgress } from "./identityProgress";
import { useGoogleIdentityEstablishment } from "./google/useGoogleIdentityEstablishment";
import { BackButton } from "@/client/ui/shared/backButton";
import { ProviderChoice } from "./providerChoice";
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
  const google = useGoogleIdentityEstablishment(forAuthorization);
  const apple = useAppleIdentity();
  const appleEnabled = apple !== null;
  // With only Google, an authorization starts Google at once, as before Apple. With Apple too,
  // the person picks a provider; Google's own redirect still resumes on its return.
  const startsGoogleAutomatically = forAuthorization && (!appleEnabled || isGoogleRedirectReturn());
  const automaticallyStarted = useRef(false);
  useEffect(() => {
    if (!startsGoogleAutomatically || automaticallyStarted.current) return;
    let active = true;
    // Wait through StrictMode's setup/cleanup probe before starting one navigation.
    queueMicrotask(() => {
      if (!active || automaticallyStarted.current) return;
      automaticallyStarted.current = true;
      google.establishIdentity();
    });
    return () => {
      active = false;
    };
  }, [startsGoogleAutomatically, google]);
  const view = google.view;
  const appleState = apple?.state;
  const restored =
    (view.status === "complete" && view.mode === "restored") ||
    (appleState?.status === "established" && appleState.identity.establishmentMode === "restored");
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

  if (apple && isAppleFlowActive(apple)) {
    return <AppleEstablishment apple={apple} onComplete={onComplete} />;
  }

  switch (view.status) {
    case "complete":
      if (view.mode === "restored") return null;
      return (
        <IdentityComplete
          account={{ provider: "google", googleAccount: view.googleAccount }}
          identity={view.identity}
          notice={visibleRecoveryCopyNotice(view.visibleRecoveryCopyStatus)}
          onContinue={onComplete}
          storageName="Google Drive"
        />
      );
    case "requesting-access":
      return <GoogleAccessScreen fullWidthAction={forAuthorization} />;
    case "failed": {
      return (
        <GoogleIdentityError
          error={view.error}
          onBack={forAuthorization && onBack ? onBack : google.back}
          onReplaceInvalidFile={google.replaceInvalidPassportFile}
          onReplaceUndecryptableFile={google.replaceUndecryptablePassportFile}
          onTryAgain={google.establishIdentity}
          onContinueWithoutVisibleBackup={google.continueWithoutVisibleBackup}
        />
      );
    }
    case "working":
      return <IdentityProgress progress={view.progress} storageName="Google Drive" />;
    case "idle":
      if (startsGoogleAutomatically) return <GoogleAccessScreen fullWidthAction />;
      return (
        <SignInPage appleEnabled={appleEnabled}>
          <ProviderChoice
            apple={apple ? { ready: apple.ready, onContinue: apple.continueWithApple } : null}
            onContinueWithGoogle={google.establishIdentity}
          />
          {onBack ? <BackButton className="md:mt-auto" onClick={onBack} /> : null}
        </SignInPage>
      );
  }
}

function isAppleFlowActive(apple: AppleIdentityHandle): boolean {
  switch (apple.state.status) {
    case "idle":
    case "detaching":
    case "detached":
      return false;
    default:
      return true;
  }
}

/** Screens of the two-step Apple flow: Apple's sign-in, then Connect iCloud, then setup. */
function AppleEstablishment({
  apple,
  onComplete,
}: {
  apple: AppleIdentityHandle;
  onComplete: () => void;
}) {
  const state = apple.state;
  switch (state.status) {
    case "requesting-apple":
      return <AppleSignInScreen onFocus={apple.focusSignIn} onCancel={apple.cancelSignIn} />;
    case "connect-icloud":
    case "connecting-icloud":
      return (
        <ConnectICloudScreen
          notice={state.status === "connect-icloud" ? state.notice : undefined}
          onBack={apple.reset}
          onConnect={apple.connectICloud}
          onFocus={apple.focusICloud}
          onCancel={apple.cancelICloud}
          pending={state.status === "connecting-icloud"}
          purpose="setup"
          ready={state.status === "connect-icloud" ? state.ready : true}
        />
      );
    case "establishing":
      return <IdentityProgress progress={state.progress} storageName="iCloud" />;
    case "established":
      // A restore moves straight on (see the effect above), so it shows nothing.
      if (state.identity.establishmentMode === "restored") return null;
      return (
        <IdentityComplete
          account={{ provider: "apple", appleAccount: state.identity.appleAccount }}
          identity={state.identity.publicIdentity}
          onContinue={onComplete}
          storageName="iCloud"
        />
      );
    case "failed":
      return (
        <AppleIdentityError
          appleEmail={state.appleEmail}
          error={state.error}
          onBack={apple.reset}
          onReplaceInvalidFile={apple.replaceInvalidPassportFile}
          onReplaceUndecryptableFile={apple.replaceUndecryptablePassportFile}
          onTryAgain={apple.continueWithApple}
        />
      );
    case "idle":
    case "detaching":
    case "detached":
      return null;
  }
}

function visibleRecoveryCopyNotice(
  status: "created" | "unconfirmed" | "skipped",
): string | undefined {
  switch (status) {
    case "created":
      return undefined;
    case "skipped":
      return "Your identity is ready. No visible recovery copy was created in Google Drive because you did not grant that permission. Download a recovery file from identity management.";
    case "unconfirmed":
      return "Your identity is ready, but Passport could not confirm the visible recovery copy in Google Drive. Download a recovery file from identity management.";
  }
}

export { IdentityEstablishmentFlow };
