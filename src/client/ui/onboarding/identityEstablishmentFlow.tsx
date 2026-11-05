import { useEffect, useRef } from "react";
import { preload } from "react-dom";

import { GoogleAccessScreen } from "./google/googleAccessScreen";
import { GoogleIdentityError } from "./google/googleIdentityError";
import { IdentityComplete } from "./identityComplete";
import { IdentityProgress } from "./identityProgress";
import { ContinueWithGoogle } from "./google/continueWithGoogle";
import { useGoogleIdentityEstablishment } from "./google/useGoogleIdentityEstablishment";
import { BackButton } from "@/client/ui/shared/backButton";
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
  const automaticallyStarted = useRef(false);
  useEffect(() => {
    if (!forAuthorization || automaticallyStarted.current) return;
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
  }, [forAuthorization, google]);
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
      if (forAuthorization) return <GoogleAccessScreen fullWidthAction />;
      return (
        <SignInPage>
          <ContinueWithGoogle onContinue={google.establishIdentity} />
          {onBack ? <BackButton className="md:mt-auto" onClick={onBack} /> : null}
        </SignInPage>
      );
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
