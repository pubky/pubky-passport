"use client";

import { useState } from "react";

import type { GoogleIdentityConfiguration } from "../../../../logic/google-identity/GoogleIdentityController";
import type { LocalIdentityBackupResult } from "../../../../logic/local-identity/LocalIdentityController";
import type { LocalIdentityMetadata } from "../../../../logic/local-identity/localIdentityModels";
import { EncryptedBackup } from "../encrypted-backup/encryptedBackup";
import { MigrateToPubkyRing } from "../migrate-to-pubky-ring/migrateToPubkyRing";
import { BackupBeforeDetaching } from "./backupBeforeDetaching";
import { ConfirmGoogleDetachment } from "./confirmGoogleDetachment";
import { GoogleDetachmentComplete } from "./googleDetachmentComplete";
import { ReviewGoogleDetachment } from "./reviewGoogleDetachment";
import { useDetachFromGoogle } from "./useDetachFromGoogle";

type DetachFromGoogleView =
  | { view: "backup" }
  | { view: "encrypted-backup" }
  | { view: "pubky-ring" }
  | { view: "review"; confirmation: "closed" | "open" };

function DetachFromGoogleFlow({ createBackup, createMigrationUrl, googleIdentityConfiguration, identity, onBack, onDone }: {
  createBackup: (publicKeyZ32: string, password: string) => Promise<LocalIdentityBackupResult>;
  createMigrationUrl: () => string | null;
  googleIdentityConfiguration: GoogleIdentityConfiguration;
  identity: LocalIdentityMetadata;
  onBack: () => void;
  onDone: () => void;
}) {
  const [state, setState] = useState<DetachFromGoogleView>({ view: "backup" });
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
        onBack={() => setState({ view: "backup" })}
      />;
    case "pubky-ring":
      return <MigrateToPubkyRing
        createMigrationUrl={createMigrationUrl}
        onBack={() => setState({ view: "backup" })}
      />;
    case "review": {
      const pending = operation.state.name === "requesting-authorization"
        || operation.state.name === "deleting-backup";
      return (
        <>
          <ReviewGoogleDetachment onBack={() => setState({ view: "backup" })} onRemove={() => setState({ view: "review", confirmation: "open" })} />
          <ConfirmGoogleDetachment
            canConfirm={operation.state.name === "ready" || operation.state.name === "operation-failed"}
            canRetryAuthorization={operation.state.name === "authorization-failed"}
            error={operation.state.name === "authorization-failed"
              ? "authorization_failed"
              : operation.state.name === "operation-failed"
                ? operation.state.error.code
                : null}
            onCancel={() => setState({ view: "review", confirmation: "closed" })}
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
        onBackupConfirmed={() => setState({ view: "review", confirmation: "closed" })}
        onDownloadBackup={() => setState({ view: "encrypted-backup" })}
        onMigrateToKeychain={() => setState({ view: "pubky-ring" })}
      />;
  }
}

export { DetachFromGoogleFlow };
