import { useEffect, useRef, useState } from "react";
import { preload } from "react-dom";

import type { IdentityProviderHint } from "@/client/logic/authorization/entry/identityProviderHint";
import { isGoogleRedirectReturn } from "@/client/logic/google-identity/gia/googleRedirectBootstrap";
import { useAppleIdentity, type AppleIdentityHandle } from "@/client/ui/useAppleIdentity";
import { AppleIdentityError } from "./apple/appleIdentityError";
import { AppleSignInScreen } from "./apple/appleSignInScreen";
import { ConnectICloudScreen } from "./apple/connectICloudScreen";
import { ContinueWithApple } from "./apple/continueWithApple";
import { GoogleAccessScreen } from "./google/googleAccessScreen";
import { GoogleIdentityError } from "./google/googleIdentityError";
import { IdentityComplete } from "./identityComplete";
import { IdentityProgress } from "./identityProgress";
import { ContinueWithGoogle } from "./google/continueWithGoogle";
import { useGoogleIdentityEstablishment } from "./google/useGoogleIdentityEstablishment";
import { BackButton } from "@/client/ui/shared/backButton";
import { Button } from "@/client/ui/shared/primitives/button";
import { SignInPage } from "./signInPage";

function IdentityEstablishmentFlow({
  forAuthorization = false,
  providerHint,
  onBack,
  onComplete,
}: {
  forAuthorization?: boolean | undefined;
  /** The provider the app says the person chose (`x-provider`); authorization only. */
  providerHint?: IdentityProviderHint | undefined;
  onBack?: (() => void) | undefined;
  onComplete: () => void;
}) {
  const google = useGoogleIdentityEstablishment(forAuthorization);
  const apple = useAppleIdentity();
  const appleEnabled = apple !== null;
  const hint = forAuthorization ? providerHint : undefined;
  // An authorization starts Google's same-tab redirect at once when Google is the only provider
  // or the app already chose Google, and when it returns from that redirect. An app that chose
  // Apple never lands on Google by itself, even where Apple is off.
  const startsGoogleAutomatically =
    forAuthorization &&
    (isGoogleRedirectReturn() || hint === "google" || (!appleEnabled && hint !== "apple"));
  // The app chose Apple: show only Apple's step. Its popup still needs this page's own click.
  const [showsAllProviders, setShowsAllProviders] = useState(false);
  const startsWithApple = hint === "apple" && appleEnabled && !showsAllProviders;
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
      if (apple && startsWithApple) {
        return (
          <SignInPage provider="apple">
            <ContinueWithApple disabled={!apple.ready} onContinue={apple.continueWithApple} />
            <Button
              className="w-full"
              onClick={() => setShowsAllProviders(true)}
              size="lg"
              type="button"
              variant="ghost"
            >
              Other sign-in options
            </Button>
            {onBack ? <BackButton className="md:mt-auto" onClick={onBack} /> : null}
          </SignInPage>
        );
      }
      return (
        <SignInPage provider={appleEnabled ? "google-or-apple" : "google"}>
          <ContinueWithGoogle onContinue={google.establishIdentity} />
          {apple ? (
            <ContinueWithApple disabled={!apple.ready} onContinue={apple.continueWithApple} />
          ) : null}
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
    case "established":
      return apple.state.identity.establishmentMode === "created";
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
      return <AppleSignInScreen />;
    case "connect-icloud":
    case "connecting-icloud":
      return (
        <ConnectICloudScreen
          notice={state.status === "connect-icloud" ? state.notice : undefined}
          onBack={apple.reset}
          onConnect={apple.connectICloud}
          pending={state.status === "connecting-icloud"}
          purpose="setup"
          ready={state.status === "connect-icloud" ? state.ready : true}
        />
      );
    case "establishing":
      return <IdentityProgress progress={state.progress} storageName="iCloud" />;
    case "established":
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
