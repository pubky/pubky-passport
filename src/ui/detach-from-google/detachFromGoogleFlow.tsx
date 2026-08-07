"use client";

import { useState } from "react";

import type { LocalIdentitySummary, PassportIdentityController } from "../../browser/identity/passportIdentity";
import { EncryptedBackup } from "../identity-management/encryptedBackup";
import { BackupBeforeDetaching } from "./backupBeforeDetaching";
import { ConfirmGoogleDetachment } from "./confirmGoogleDetachment";
import { GoogleDetachmentComplete } from "./googleDetachmentComplete";
import { useDetachFromGoogle } from "./useDetachFromGoogle";

type DetachScreen = "backup" | "encrypted-backup";

function DetachFromGoogleFlow({ controller, identity, onBack, onDone }: {
  controller: PassportIdentityController;
  identity: LocalIdentitySummary;
  onBack: () => void;
  onDone: () => void;
}) {
  const [screen, setScreen] = useState<DetachScreen>("backup");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const detachment = useDetachFromGoogle(
    controller,
    identity.publicIdentity,
    identity.googleAccount?.id ?? "",
  );

  if (detachment.status === "complete") return <GoogleDetachmentComplete onDone={onDone} />;
  if (screen === "encrypted-backup") {
    return <EncryptedBackup
      createBackup={controller.createBackup.bind(controller)}
      identityId={identity.id}
      onBack={() => setScreen("backup")}
    />;
  }

  return (
    <>
      <BackupBeforeDetaching
        onBack={onBack}
        onBackupConfirmed={() => setConfirmationOpen(true)}
        onDownloadBackup={() => setScreen("encrypted-backup")}
      />
      <ConfirmGoogleDetachment
        canConfirm={detachment.canDetach}
        canRetryAuthorization={detachment.canRetryAuthorization}
        error={detachment.status === "error"}
        onCancel={() => setConfirmationOpen(false)}
        onConfirm={detachment.detach}
        onRetryAuthorization={detachment.retryAuthorization}
        open={confirmationOpen}
        pending={detachment.status === "pending"}
      />
    </>
  );
}

export { DetachFromGoogleFlow };
