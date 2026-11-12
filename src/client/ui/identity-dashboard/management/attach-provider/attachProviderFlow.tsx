import { preload } from "react-dom";

import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { GoogleDrivePermissionPrompt } from "@/client/ui/googleDrivePermissionPrompt";
import { googleIdentityErrorMessage } from "@/client/ui/googleIdentityErrorMessage";
import {
  appleIdentityErrorMessage,
  signedInAppleAccountNotice,
} from "@/client/ui/onboarding/apple/appleIdentityErrorMessage";
import { AppleSignInScreen } from "@/client/ui/onboarding/apple/appleSignInScreen";
import { ConnectICloudScreen } from "@/client/ui/onboarding/apple/connectICloudScreen";
import { GoogleAccessScreen } from "@/client/ui/onboarding/google/googleAccessScreen";
import { useAppleIdentity, type AppleIdentityHandle } from "@/client/ui/useAppleIdentity";
import { useGoogleIdentityStore } from "@/client/ui/useGoogleIdentityStore";
import {
  AttachComplete,
  AttachError,
  AttachingScreen,
  AttachProviderChoice,
} from "./attachProviderScreens";

/**
 * Gives an identity that is only in this browser the normal Google or Apple backup. Each provider
 * runs its own sign-in exactly as in setup; Back or a failure at any step leaves the identity as
 * it was. `onDone` returns to Manage identity, which then shows the account.
 */
function AttachProviderFlow({
  identity,
  onBack,
  onDone,
}: {
  identity: LocalIdentityMetadata;
  onBack: () => void;
  onDone: () => void;
}) {
  const publicIdentity = identity.publicIdentity;
  const google = useGoogleIdentityStore("attachment");
  const apple = useAppleIdentity();
  const attachWithGoogle = () =>
    google.run("attach", (controller) => controller.attachIdentity(publicIdentity));

  preload("/illustrations/checkmark.png", { as: "image" });

  if (apple && apple.state.status !== "idle") {
    return <AppleAttachment apple={apple} identity={identity} onDone={onDone} />;
  }

  const state = google.state;
  switch (state.status) {
    case "requesting-authorization":
      return <GoogleAccessScreen purpose="attach" />;
    case "attaching":
      return <AttachingScreen storageName="Google Drive" />;
    case "attached":
      return (
        <AttachComplete
          account={{ provider: "google", googleAccount: state.identity.googleAccount }}
          attachment={state.identity.attachment}
          notice={visibleRecoveryCopyNotice(
            state.identity.attachment,
            state.identity.visibleRecoveryCopyStatus,
          )}
          onDone={onDone}
          publicIdentity={publicIdentity}
          storageName="Google Drive"
        />
      );
    case "failed":
      if (
        state.error.code === "google_drive_access_required" ||
        state.error.code === "google_authorization_denied"
      ) {
        return (
          <GoogleDrivePermissionPrompt
            mode="required"
            onBack={google.reset}
            onTryAgain={attachWithGoogle}
          />
        );
      }
      return (
        <AttachError
          error={state.error}
          message={googleIdentityErrorMessage(state.error.code)}
          onBack={google.reset}
          onTryAgain={attachWithGoogle}
          provider="Google"
        />
      );
    case "idle":
    case "establishing":
    case "established":
    case "detaching":
    case "detached":
      return (
        <AttachProviderChoice
          apple={
            apple
              ? { ready: apple.ready, onContinue: () => apple.attachIdentity(publicIdentity) }
              : null
          }
          onBack={onBack}
          onContinueWithGoogle={attachWithGoogle}
          publicIdentity={publicIdentity}
        />
      );
  }
}

/** Apple's two steps, as in setup: Apple's sign-in, then Connect iCloud, then the backup. */
function AppleAttachment({
  apple,
  identity,
  onDone,
}: {
  apple: AppleIdentityHandle;
  identity: LocalIdentityMetadata;
  onDone: () => void;
}) {
  const state = apple.state;
  const publicIdentity = identity.publicIdentity;
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
    case "attaching":
      return <AttachingScreen storageName="iCloud" />;
    case "attached":
      return (
        <AttachComplete
          account={{ provider: "apple", appleAccount: state.identity.appleAccount }}
          attachment={state.identity.attachment}
          onDone={onDone}
          publicIdentity={publicIdentity}
          storageName="iCloud"
        />
      );
    case "failed":
      return (
        <AttachError
          accountNotice={
            state.appleEmail ? signedInAppleAccountNotice(state.appleEmail) : undefined
          }
          error={state.error}
          message={appleIdentityErrorMessage(state.error.code)}
          onBack={apple.reset}
          onTryAgain={() => apple.attachIdentity(publicIdentity)}
          provider="Apple"
        />
      );
    case "idle":
    case "establishing":
    case "established":
    case "detaching":
    case "detached":
      // Not reached: the flow only starts an attach, and idle shows the provider choice.
      return null;
  }
}

/** A Drive file that was already there gets no new visible copy, so nothing to report. */
function visibleRecoveryCopyNotice(
  attachment: "created" | "linked",
  status: "created" | "unconfirmed" | "skipped",
): string | undefined {
  if (attachment === "linked") return undefined;
  switch (status) {
    case "created":
      return undefined;
    case "skipped":
      return "No visible recovery copy was created in Google Drive because you did not grant that permission. Keep your recovery file or phrase.";
    case "unconfirmed":
      return "Passport could not confirm the visible recovery copy in Google Drive. Keep your recovery file or phrase.";
  }
}

export { AttachProviderFlow };
