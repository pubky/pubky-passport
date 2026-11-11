import { useState } from "react";
import { preload } from "react-dom";

import type { LocalIdentityRecoveryFileResult } from "@/client/logic/local-identity/LocalIdentityController";
import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { PubkyRingMigration } from "@/client/logic/pubky/PubkySdkAdapter";
import { RecoveryFileDownload } from "@/client/ui/identity-dashboard/management/recovery-file/recoveryFileDownload";
import { MigrateToPubkyRing } from "@/client/ui/identity-dashboard/management/migrate-to-pubky-ring/migrateToPubkyRing";
import { GoogleDrivePermissionPrompt } from "@/client/ui/googleDrivePermissionPrompt";
import { DetachmentComplete } from "@/client/ui/identity-dashboard/management/detach-provider/detachmentComplete";
import { RecoveryBeforeDetaching } from "@/client/ui/identity-dashboard/management/detach-provider/recoveryBeforeDetaching";
import { ReviewDetachment } from "@/client/ui/identity-dashboard/management/detach-provider/reviewDetachment";
import { ConfirmGoogleDetachment } from "./confirmGoogleDetachment";
import { useDetachFromGoogle } from "./useDetachFromGoogle";

type DetachFromGoogleView =
  | { view: "recovery-options" }
  | { view: "recovery-file" }
  | { view: "pubky-ring" }
  | { view: "review"; confirmation: "closed" | "open" };

function DetachFromGoogleFlow({
  createRecoveryFile,
  createMigration,
  googleSubject,
  identity,
  onBack,
  onDone,
}: {
  createRecoveryFile: (
    publicKeyZ32: string,
    password: string,
  ) => Promise<LocalIdentityRecoveryFileResult>;
  createMigration: () => Promise<LocalIdentityResult<PubkyRingMigration>>;
  googleSubject: string;
  identity: LocalIdentityMetadata;
  onBack: () => void;
  onDone: () => void;
}) {
  const [state, setState] = useState<DetachFromGoogleView>({ view: "recovery-options" });
  const operation = useDetachFromGoogle(identity.publicIdentity, googleSubject);

  preload("/illustrations/cloud.png", { as: "image" });
  preload("/illustrations/red-line.svg", { as: "image" });
  if (state.view === "review") preload("/illustrations/checkmark.png", { as: "image" });

  if (operation.state.status === "complete")
    return <DetachmentComplete onDone={onDone} providerName="Google" />;

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
      const pending =
        operation.state.status === "requesting-authorization" ||
        operation.state.status === "detaching";
      return (
        <>
          <ReviewDetachment
            providerName="Google"
            onBack={() => setState({ view: "recovery-options" })}
            onRemove={() => setState({ view: "review", confirmation: "open" })}
          />
          <ConfirmGoogleDetachment
            canConfirm={
              operation.state.status === "ready" || operation.state.status === "operation-failed"
            }
            canRetryAuthorization={operation.state.status === "authorization-failed"}
            error={
              operation.state.status === "authorization-failed" ||
              operation.state.status === "operation-failed"
                ? operation.state.error
                : null
            }
            onCancel={() => setState({ view: "review", confirmation: "closed" })}
            onConfirm={operation.detach}
            onRetryAuthorization={operation.retryDetachment}
            open={state.confirmation === "open"}
            pending={pending}
          />
        </>
      );
    }
    case "recovery-options":
      return (
        <RecoveryBeforeDetaching
          providerName="Google"
          onBack={onBack}
          onRecoveryConfirmed={() => setState({ view: "review", confirmation: "closed" })}
          onDownloadRecoveryFile={() => setState({ view: "recovery-file" })}
          onMigrateToKeychain={() => setState({ view: "pubky-ring" })}
        />
      );
  }
}

export { DetachFromGoogleFlow };
