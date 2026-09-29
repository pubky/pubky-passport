import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";

import { GoogleAccessScreen } from "./google/googleAccessScreen";
import { GoogleIdentityComplete } from "./google/googleIdentityComplete";
import { GoogleIdentityError } from "./google/googleIdentityError";
import { GoogleIdentityProgress } from "./google/googleIdentityProgress";
import { useGoogleIdentityEstablishment } from "./google/useGoogleIdentityEstablishment";

/**
 * Drives Google identity establishment. The idle entry screen belongs to the parent. Starting is
 * never gated on Homegate: restoring an identity does not use it, and creating one reports a
 * Homegate failure through the error screen.
 */
function IdentityEstablishmentFlow({
  forAuthorization = false,
  renderEntry,
  onComplete,
}: {
  forAuthorization?: boolean | undefined;
  renderEntry: (startGoogle: () => void) => ReactNode;
  onComplete: (identity: LocalIdentityMetadata) => void;
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
      return (
        <GoogleAccessScreen
          fullWidthAction={forAuthorization}
          onCancel={google.cancelAuthorization}
          onShowGoogleWindow={google.showAuthorizationWindow}
        />
      );
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
      return renderEntry(google.establishIdentity);
  }
}

export { IdentityEstablishmentFlow };
