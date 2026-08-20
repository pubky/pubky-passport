"use client";

import { useReducer } from "react";

import type { GoogleIdentityConfiguration } from "../../../../logic/google-identity/GoogleIdentityController";
import type { LocalIdentityBackupResult } from "../../../../logic/local-identity/LocalIdentityController";
import type { LocalIdentityMetadata } from "../../../../logic/local-identity/localIdentityModels";
import { EncryptedBackup } from "../encrypted-backup/encryptedBackup";
import { MigrateToPubkyRing } from "../migrate-to-pubky-ring/migrateToPubkyRing";
import { BackupBeforeDetaching } from "./backupBeforeDetaching";
import { ConfirmGoogleDetachment } from "./confirmGoogleDetachment";
import { transitionDetachFromGoogleFlow } from "./detachFromGoogleFlowState";
import { GoogleDetachmentComplete } from "./googleDetachmentComplete";
import { ReviewGoogleDetachment } from "./reviewGoogleDetachment";
import { useDetachFromGoogle } from "./useDetachFromGoogle";

function DetachFromGoogleFlow({ createBackup, createMigrationUrl, googleIdentityConfiguration, identity, onBack, onDone }: {
  createBackup: (publicKeyZ32: string, password: string) => Promise<LocalIdentityBackupResult>;
  createMigrationUrl: () => string | null;
  googleIdentityConfiguration: GoogleIdentityConfiguration;
  identity: LocalIdentityMetadata;
  onBack: () => void;
  onDone: () => void;
}) {
  const [state, dispatch] = useReducer(transitionDetachFromGoogleFlow, { view: "backup" });
  const operation = useDetachFromGoogle(
    googleIdentityConfiguration,
    identity.publicIdentity,
    identity.googleAccount?.id ?? "",
  );

  if (operation.state.name === "complete") return <GoogleDetachmentComplete onDone={onDone} />;

  switch (state.view) {
    case "encrypted-backup":
      return <EncryptedBackup
        createBackup={createBackup}
        publicKeyZ32={identity.publicIdentity.publicKeyZ32}
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
            error={operation.state.name === "authorization-failed"
              ? "authorization_failed"
              : operation.state.name === "operation-failed"
                ? operation.state.error.code
                : null}
            onCancel={() => dispatch({ type: "confirmation-closed" })}
            onConfirm={operation.detach}
            onRetryAuthorization={operation.retryDetachment}
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
          dispatch({
            type: "migration-requested",
            migrationUrl: createMigrationUrl(),
          });
        }}
      />;
  }
}

export { DetachFromGoogleFlow };
