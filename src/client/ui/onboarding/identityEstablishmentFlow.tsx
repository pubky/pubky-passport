import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";

import { LoadingScreen } from "@/client/ui/shared/loadingScreen";
import { GoogleAccessScreen } from "./google/googleAccessScreen";
import { GoogleIdentityComplete } from "./google/googleIdentityComplete";
import { GoogleIdentityError } from "./google/googleIdentityError";
import { GoogleIdentityProgress } from "./google/googleIdentityProgress";
import { useGoogleIdentityEstablishment } from "./google/useGoogleIdentityEstablishment";

/**
 * Drives Google identity establishment. The idle entry screen belongs to the parent. Starting is
 * never gated on Homegate: restoring an identity does not use it, and creating one reports a
 * Homegate failure through the error screen.
 *
 * Google opens in its own window everywhere. For a waiting request (`forAuthorization`) a blocked
 * window is not the end: the page says so and leaves for Google itself, and Google returns to the
 * origin root, where `googleReturn` is set and the establishment that left goes on by itself,
 * once, without another press. A person closing Google's window is not a block: the error screen
 * offers Try again, and nothing leaves.
 */
function IdentityEstablishmentFlow({
  forAuthorization = false,
  googleReturn,
  renderEntry,
  onComplete,
}: {
  forAuthorization?: boolean | undefined;
  /**
   * Set on the page Google returned to. `onLeave` goes back to the request's own page, which is
   * where Back from a failure leads: this page shows nothing else of the request.
   */
  googleReturn?: { onLeave: () => void } | undefined;
  renderEntry: (startGoogle: () => void) => ReactNode;
  onComplete: (identity: LocalIdentityMetadata) => void;
}) {
  const google = useGoogleIdentityEstablishment(forAuthorization);
  const resumed = useRef(false);
  useEffect(() => {
    if (!googleReturn || resumed.current) return;
    let active = true;
    // Wait through StrictMode's setup/cleanup probe before continuing, so it happens once.
    queueMicrotask(() => {
      if (!active || resumed.current) return;
      resumed.current = true;
      google.establishIdentity();
    });
    return () => {
      active = false;
    };
  }, [googleReturn, google]);
  const view = google.view;
  const restored = view.status === "complete" && view.mode === "restored";
  const restorationReported = useRef(false);

  // A restored identity needs no confirmation screen: the caller moves straight on.
  useEffect(() => {
    if (!restored) {
      restorationReported.current = false;
      return;
    }
    if (restorationReported.current || view.status !== "complete") return;
    restorationReported.current = true;
    onComplete({ publicIdentity: view.identity, googleAccount: view.googleAccount });
  }, [onComplete, restored, view]);

  switch (view.status) {
    case "complete":
      if (view.mode === "restored") return null;
      return (
        <GoogleIdentityComplete
          googleAccount={view.googleAccount}
          identity={view.identity}
          visibleRecoveryCopyStatus={view.visibleRecoveryCopyStatus}
          onContinue={() =>
            onComplete({ publicIdentity: view.identity, googleAccount: view.googleAccount })
          }
        />
      );
    case "requesting-access":
      // In this window there is no Google window to show or cancel: the page is leaving for
      // Google, or taking its answer on the way back.
      if (view.inThisTab) return <ContinuingInThisTab />;
      return (
        <GoogleAccessScreen
          onCancel={google.cancelAuthorization}
          onShowGoogleWindow={google.showAuthorizationWindow}
        />
      );
    case "failed": {
      return (
        <GoogleIdentityError
          error={view.error}
          onBack={googleReturn ? googleReturn.onLeave : google.back}
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
      // Back from Google, the establishment continues above; the entry is not offered again here.
      if (googleReturn) return <ContinuingInThisTab />;
      return renderEntry(google.establishIdentity);
  }
}

/** Shown while the page leaves for Google, and again while it takes Google's answer. */
function ContinuingInThisTab() {
  return (
    <LoadingScreen
      label="Continuing with Google"
      message="Your browser blocked Google’s window, so Passport continues in this tab."
    />
  );
}

export { IdentityEstablishmentFlow };
