"use client";

import { Result } from "better-result";
import { useReducer } from "react";

import type { LocalIdentitySummary, PassportIdentityController } from "../../../../browser/identity/passportIdentity";
import { EncryptedBackup } from "../encrypted-backup/encryptedBackup";
import { MigrateToPubkyRing } from "../migrate-to-pubky-ring/migrateToPubkyRing";
import { BackupBeforeDetaching } from "./backupBeforeDetaching";
import { ConfirmGoogleDetachment } from "./confirmGoogleDetachment";
import { transitionDetachFromGoogleFlow } from "./detachFromGoogleFlowState";
import { GoogleDetachmentComplete } from "./googleDetachmentComplete";
import { ReviewGoogleDetachment } from "./reviewGoogleDetachment";
import { useDetachFromGoogle } from "./useDetachFromGoogle";

function DetachFromGoogleFlow({ controller, identity, onBack, onDone }: {
  controller: PassportIdentityController;
  identity: LocalIdentitySummary;
  onBack: () => void;
  onDone: () => void;
}) {
  const [state, dispatch] = useReducer(transitionDetachFromGoogleFlow, { view: "backup" });
  const operation = useDetachFromGoogle(
    controller,
    identity.publicIdentity,
    identity.googleAccount?.id ?? "",
  );

  if (operation.state.name === "complete") return <GoogleDetachmentComplete onDone={onDone} />;

  switch (state.view) {
    case "encrypted-backup":
      return <EncryptedBackup
        createBackup={controller.createBackup.bind(controller)}
        identityId={identity.id}
        onBack={() => dispatch({ type: "back-to-backup" })}
      />;
    case "pubky-ring":
      return <MigrateToPubkyRing
        migrationUrl={state.migrationUrl}
        onBack={() => dispatch({ type: "back-to-backup" })}
      />;
    case "review": {
      const pending = operation.state.name === "requesting-authorization"
        || operation.state.name === "deleting-backup";
      return (
        <>
          <ReviewGoogleDetachment onBack={() => dispatch({ type: "back-to-backup" })} onRemove={() => dispatch({ type: "confirmation-requested" })} />
          <ConfirmGoogleDetachment
            canConfirm={operation.state.name === "ready" || operation.state.name === "operation-failed"}
            canRetryAuthorization={operation.state.name === "authorization-failed"}
            error={operation.state.name === "authorization-failed" || operation.state.name === "operation-failed"}
            onCancel={() => dispatch({ type: "confirmation-closed" })}
            onConfirm={operation.detach}
            onRetryAuthorization={operation.retryAuthorization}
            open={state.confirmation === "open"}
            pending={pending}
          />
        </>
      );
    }
    case "backup":
      return <BackupBeforeDetaching
        onBack={onBack}
        onBackupConfirmed={() => dispatch({ type: "backup-confirmed" })}
        onDownloadBackup={() => dispatch({ type: "backup-requested" })}
        onMigrateToKeychain={() => {
          const migration = controller.createPubkyRingMigrationUrl();
          dispatch({
            type: "migration-requested",
            migrationUrl: Result.isOk(migration) ? migration.value : null,
          });
        }}
      />;
  }
}

export { DetachFromGoogleFlow };
