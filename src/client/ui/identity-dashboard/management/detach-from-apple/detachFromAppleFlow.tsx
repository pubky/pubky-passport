import { useState } from "react";
import { preload } from "react-dom";

import type { LocalIdentityRecoveryFileResult } from "@/client/logic/local-identity/LocalIdentityController";
import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { PubkyRingMigration } from "@/client/logic/pubky/PubkySdkAdapter";
import { DetachmentComplete } from "@/client/ui/identity-dashboard/management/detach-provider/detachmentComplete";
import { RecoveryBeforeDetaching } from "@/client/ui/identity-dashboard/management/detach-provider/recoveryBeforeDetaching";
import { ReviewDetachment } from "@/client/ui/identity-dashboard/management/detach-provider/reviewDetachment";
import { MigrateToPubkyRing } from "@/client/ui/identity-dashboard/management/migrate-to-pubky-ring/migrateToPubkyRing";
import { RecoveryFileDownload } from "@/client/ui/identity-dashboard/management/recovery-file/recoveryFileDownload";
import { GoogleIdentityErrorDetails as IdentityErrorDetails } from "@/client/ui/googleIdentityErrorDetails";
import {
  appleIdentityErrorMessage,
  signedInAppleAccountNotice,
} from "@/client/ui/onboarding/apple/appleIdentityErrorMessage";
import { ConnectICloudScreen } from "@/client/ui/onboarding/apple/connectICloudScreen";
import { ConfirmDeletionDialog } from "@/client/ui/shared/confirmDeletionDialog";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { AppleSignInScreen } from "@/client/ui/onboarding/apple/appleSignInScreen";
import type { AppleIdentityHandle } from "@/client/ui/useAppleIdentity";

type DetachFromAppleView =
  | { view: "recovery-options" }
  | { view: "recovery-file" }
  | { view: "pubky-ring" }
  | { view: "review"; confirmation: "closed" | "open" };

/**
 * Removes Apple access: Sign in with Apple proves the account, then Connect iCloud lets Passport
 * check that the iCloud record holds this identity before deleting it and the local copy.
 */
function DetachFromAppleFlow({
  apple,
  appleSubject,
  createMigration,
  createRecoveryFile,
  identity,
  onBack,
  onDone,
}: {
  apple: AppleIdentityHandle;
  appleSubject: string;
  createMigration: () => Promise<LocalIdentityResult<PubkyRingMigration>>;
  createRecoveryFile: (
    publicKeyZ32: string,
    password: string,
  ) => Promise<LocalIdentityRecoveryFileResult>;
  identity: LocalIdentityMetadata;
  onBack: () => void;
  onDone: () => void;
}) {
  const [state, setState] = useState<DetachFromAppleView>({ view: "recovery-options" });
  const operation = apple.state;

  preload("/illustrations/cloud.png", { as: "image" });
  preload("/illustrations/red-line.svg", { as: "image" });

  if (operation.status === "detached") {
    return <DetachmentComplete onDone={onDone} providerName="Apple" />;
  }
  if (operation.status === "requesting-apple") {
    return <AppleSignInScreen onFocus={apple.focusSignIn} onCancel={apple.cancelSignIn} />;
  }
  if (operation.status === "detaching") {
    return (
      <PassportScreen className="gap-6">
        <DisplayHeading accent="access.">Removing Apple</DisplayHeading>
        <LeadText role="status">
          Passport is deleting its encrypted backup from iCloud. Keep this window open.
        </LeadText>
      </PassportScreen>
    );
  }
  if (operation.status === "connect-icloud" || operation.status === "connecting-icloud") {
    return (
      <ConnectICloudScreen
        notice={operation.status === "connect-icloud" ? operation.notice : undefined}
        onBack={() => {
          apple.reset();
          setState({ view: "review", confirmation: "closed" });
        }}
        onConnect={apple.connectICloud}
        onFocus={apple.focusICloud}
        onCancel={apple.cancelICloud}
        pending={operation.status !== "connect-icloud"}
        purpose="detach"
        ready={operation.status === "connect-icloud" ? operation.ready : true}
      />
    );
  }

  switch (state.view) {
    case "recovery-file":
      return (
        <RecoveryFileDownload
          createRecoveryFile={createRecoveryFile}
          publicKeyZ32={identity.publicIdentity.publicKeyZ32}
          onBack={() => setState({ view: "recovery-options" })}
        />
      );
    case "pubky-ring":
      return (
        <MigrateToPubkyRing
          createMigration={createMigration}
          navigationAction="continue"
          onBack={() => setState({ view: "recovery-options" })}
        />
      );
    case "review": {
      const error = operation.status === "failed" ? operation.error : null;
      return (
        <>
          <ReviewDetachment
            onBack={() => setState({ view: "recovery-options" })}
            onRemove={() => setState({ view: "review", confirmation: "open" })}
            providerName="Apple"
          />
          <ConfirmDeletionDialog
            canConfirm={apple.ready}
            confirmLabel="Confirm detachment"
            confirmationWord="DETACH"
            error={
              error
                ? [
                    appleIdentityErrorMessage(error.code),
                    ...(operation.status === "failed" && operation.appleEmail
                      ? [signedInAppleAccountNotice(operation.appleEmail)]
                      : []),
                  ].join(" ")
                : undefined
            }
            errorDetails={error ? <IdentityErrorDetails error={error} /> : undefined}
            id="detach-apple"
            onCancel={() => {
              apple.reset();
              setState({ view: "review", confirmation: "closed" });
            }}
            onConfirm={() => apple.detachIdentity(identity.publicIdentity, appleSubject)}
            open={state.confirmation === "open"}
            title="Remove Apple Access"
          />
        </>
      );
    }
    case "recovery-options":
      return (
        <RecoveryBeforeDetaching
          onBack={onBack}
          onDownloadRecoveryFile={() => setState({ view: "recovery-file" })}
          onMigrateToKeychain={() => setState({ view: "pubky-ring" })}
          onRecoveryConfirmed={() => setState({ view: "review", confirmation: "closed" })}
          providerName="Apple"
        />
      );
  }
}

export { DetachFromAppleFlow };
