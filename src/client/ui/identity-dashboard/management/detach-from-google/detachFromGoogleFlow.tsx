import { useState } from "react";
import { preload } from "react-dom";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import type {
  LocalIdentityBackupCheckResult,
  LocalIdentityRecoveryFileResult,
} from "@/client/logic/local-identity/LocalIdentityController";
import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import { keyBackupFile } from "@/client/logic/local-identity/keyBackup";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { PubkyRingMigration } from "@/client/logic/pubky/PubkySdkAdapter";
import { RecoveryFileDownload } from "@/client/ui/identity-dashboard/management/recovery-file/recoveryFileDownload";
import { MigrateToPubkyRing } from "@/client/ui/identity-dashboard/management/migrate-to-pubky-ring/migrateToPubkyRing";
import { GoogleDrivePermissionPrompt } from "@/client/ui/googleDrivePermissionPrompt";
import { GoogleAccessScreen } from "@/client/ui/onboarding/google/googleAccessScreen";
import { RecoveryBeforeDetaching } from "./recoveryBeforeDetaching";
import { ConfirmGoogleDetachment } from "./confirmGoogleDetachment";
import { GoogleDetachmentComplete } from "./googleDetachmentComplete";
import { ReviewGoogleDetachment } from "./reviewGoogleDetachment";
import { useDetachFromGoogle } from "./useDetachFromGoogle";

type DetachFromGoogleView =
  | { view: "recovery-options" }
  | { view: "recovery-file" }
  | { view: "pubky-ring" }
  | { view: "review"; confirmation: "closed" | "open" };

/**
 * Detaching deletes the Google Drive backup, often the key's only copy outside this browser. With
 * a recovery file of this key checked (here, or checked or imported earlier) it goes on directly;
 * without one, the Drive backup is removed only after the person types that this browser will keep
 * the key's only copy. Every screen names the Google account whose backup goes.
 */
function DetachFromGoogleFlow({
  createRecoveryFile,
  createMigration,
  googleAccount,
  identity,
  onBack,
  onDone,
  verifyRecoveryFile,
}: {
  createRecoveryFile: (
    publicKeyZ32: string,
    password: string,
  ) => Promise<LocalIdentityRecoveryFileResult>;
  verifyRecoveryFile: (
    publicKeyZ32: string,
    recoveryFile: Uint8Array,
    password: string,
  ) => Promise<LocalIdentityBackupCheckResult>;
  createMigration: () => Promise<LocalIdentityResult<PubkyRingMigration>>;
  googleAccount: GoogleAccountProfile;
  identity: LocalIdentityMetadata;
  onBack: () => void;
  onDone: () => void;
}) {
  const [state, setState] = useState<DetachFromGoogleView>({ view: "recovery-options" });
  // A recovery file checked here proves a copy outside Google; Pubky Ring cannot report an import.
  const [backupChecked, setBackupChecked] = useState(false);
  const recordedBackup = keyBackupFile(identity);
  const recoveryFileChecked = backupChecked || recordedBackup?.verified === true;
  const operation = useDetachFromGoogle(identity.publicIdentity, googleAccount.googleSubject);

  preload("/illustrations/cloud.png", { as: "image" });
  preload("/illustrations/red-line.svg", { as: "image" });
  if (state.view === "review") preload("/illustrations/checkmark.png", { as: "image" });

  if (operation.state.status === "complete") return <GoogleDetachmentComplete onDone={onDone} />;

  switch (state.view) {
    case "recovery-file":
      return (
        <RecoveryFileDownload
          createRecoveryFile={createRecoveryFile}
          verifyRecoveryFile={verifyRecoveryFile}
          publicKeyZ32={identity.publicIdentity.publicKeyZ32}
          onBack={() => setState({ view: "recovery-options" })}
          onVerified={() => setBackupChecked(true)}
        />
      );
    case "pubky-ring":
      return (
        <MigrateToPubkyRing
          createMigration={createMigration}
          navigationAction="done"
          onBack={() => setState({ view: "recovery-options" })}
        />
      );
    case "review": {
      if (operation.state.status === "permission-required") {
        return (
          <GoogleDrivePermissionPrompt
            mode="detach"
            onBack={() => {
              operation.reset();
              setState({ view: "review", confirmation: "closed" });
            }}
            onTryAgain={operation.retryDetachment}
          />
        );
      }
      // While Google's window is open nothing is removed yet, so the person can still stop.
      if (operation.state.status === "requesting-authorization") {
        return (
          <GoogleAccessScreen
            onCancel={() => {
              operation.cancelAuthorization();
              setState({ view: "review", confirmation: "closed" });
            }}
            onShowGoogleWindow={operation.showAuthorizationWindow}
          />
        );
      }
      return (
        <>
          <ReviewGoogleDetachment
            googleAccount={googleAccount}
            onBack={() => setState({ view: "recovery-options" })}
            onRemove={() => setState({ view: "review", confirmation: "open" })}
          />
          <ConfirmGoogleDetachment
            canConfirm={
              operation.state.status === "ready" || operation.state.status === "operation-failed"
            }
            canRetryAuthorization={operation.state.status === "authorization-failed"}
            email={googleAccount.email}
            error={
              operation.state.status === "authorization-failed" ||
              operation.state.status === "operation-failed"
                ? operation.state.error
                : null
            }
            onCancel={() => setState({ view: "review", confirmation: "closed" })}
            onConfirm={operation.detach}
            onRetryAuthorization={operation.retryDetachment}
            onlyCopy={!recoveryFileChecked}
            open={state.confirmation === "open"}
            pending={operation.state.status === "detaching"}
          />
        </>
      );
    }
    case "recovery-options":
      return (
        <RecoveryBeforeDetaching
          backupChecked={backupChecked}
          recordedBackup={recordedBackup}
          onBack={onBack}
          onRecoveryConfirmed={() => setState({ view: "review", confirmation: "closed" })}
          onDownloadRecoveryFile={() => setState({ view: "recovery-file" })}
          onMigrateToKeychain={() => setState({ view: "pubky-ring" })}
        />
      );
  }
}

export { DetachFromGoogleFlow };
