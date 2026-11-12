import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { preload } from "react-dom";

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
import { LoadingScreen } from "@/client/ui/shared/loadingScreen";
import { ImportIdentityLink } from "./import-identity/importIdentityLink";
import { ImportUnavailable } from "./import-identity/importUnavailable";
import { ProviderChoice } from "./providerChoice";
import { SignInPage } from "./signInPage";

// Loaded on demand: the BIP39 wordlist and the import screens are not needed to sign in. A chunk
// that fails to load (offline, or an old tab after a deploy) shows a way back, not a crashed page.
const ImportIdentityFlow = lazy(async () => {
  try {
    const { ImportIdentityFlow } = await import("./import-identity/importIdentityFlow");
    return { default: ImportIdentityFlow };
  } catch {
    return { default: ImportUnavailable };
  }
});

function IdentityEstablishmentFlow({
  onBack,
  onComplete,
}: {
  onBack?: (() => void) | undefined;
  onComplete: () => void;
}) {
  const google = useGoogleIdentityEstablishment();
  const [importing, setImporting] = useState(false);
  const apple = useAppleIdentity();
  // Nothing starts on its own, /authorize included: the person picks a provider or the import.
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
      return <GoogleAccessScreen />;
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
      return <IdentityProgress progress={view.progress} storageName="Google Drive" />;
    case "idle":
      if (importing) {
        return (
          <Suspense fallback={<LoadingScreen label="Loading" />}>
            <ImportIdentityFlow onBack={() => setImporting(false)} onComplete={onComplete} />
          </Suspense>
        );
      }
      return (
        <SignInPage>
          <ProviderChoice
            apple={apple ? { ready: apple.ready, onContinue: apple.continueWithApple } : null}
            onContinueWithGoogle={google.establishIdentity}
            secondary={
              <>
                <ImportIdentityLink onImport={() => setImporting(true)} />
                {onBack ? <BackButton onClick={onBack} /> : null}
              </>
            }
          />
        </SignInPage>
      );
  }
}

function isAppleFlowActive(apple: AppleIdentityHandle): boolean {
  switch (apple.state.status) {
    case "idle":
    case "attaching":
    case "attached":
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
    case "attaching":
    case "attached":
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
