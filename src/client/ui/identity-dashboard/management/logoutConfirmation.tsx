import { Result } from "better-result";
import { useState } from "react";

import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { DownloadIcon } from "@/client/ui/shared/icons";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { RecoveryScreen } from "@/client/ui/shared/recoveryScreen";

/**
 * Confirms removing an identity from this browser. The backup acknowledgement and any failure
 * live here, so cancelling (which unmounts this screen) always starts the next attempt fresh.
 */
export function LogoutConfirmation({
  identity,
  onCancel,
  onDownloadBackup,
  onRemoveIdentity,
  onRemoved,
}: {
  identity: LocalIdentityMetadata;
  onCancel: () => void;
  onDownloadBackup: () => void;
  onRemoveIdentity: () => LocalIdentityResult<void>;
  onRemoved: () => void;
}) {
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
  const [removalFailed, setRemovalFailed] = useState(false);
  const browserKey = identity.keySource !== "ring";
  // Without Google Drive or Ring, logging out deletes the only copy of the key.
  const unbackedKey = browserKey && !identity.googleAccount;

  function logOut(): void {
    if (Result.isError(onRemoveIdentity())) {
      setRemovalFailed(true);
      return;
    }
    onRemoved();
  }

  return (
    <RecoveryScreen
      title="Log out of this identity?"
      description={
        browserKey
          ? "This deletes the private key saved in this browser. Your public profile remains online, and sessions in other apps stay signed in."
          : "This removes the saved identity from this browser. Your public profile remains online, and sessions in other apps stay signed in."
      }
    >
      <div className="min-w-0">
        <p className="break-words font-bold">{identity.profile?.name ?? "Your Pubky"}</p>
        <p className="break-all text-sm text-secondary-foreground">
          {identity.publicIdentity.publicKeyZ32}
        </p>
      </div>
      {unbackedKey ? (
        <>
          <FieldMessage error role="alert">
            No Google backup is attached to this identity. Without an encrypted backup or Pubky
            Ring, the key cannot be recovered after logging out.
          </FieldMessage>
          <Button onClick={onDownloadBackup} variant="secondary">
            <DownloadIcon /> Download backup
          </Button>
          <label className="flex items-start gap-3 text-sm leading-5">
            <input
              checked={backupAcknowledged}
              className="mt-0.5 size-4 shrink-0 accent-brand"
              onChange={(event) => setBackupAcknowledged(event.currentTarget.checked)}
              type="checkbox"
            />
            I have a backup of this identity and understand the key will be deleted from this
            browser.
          </label>
        </>
      ) : null}
      <PassportNavigation
        layout="paired"
        back={
          <Button variant="outline" size="lg" onClick={onCancel}>
            Cancel
          </Button>
        }
        confirm={
          <Button
            disabled={unbackedKey && !backupAcknowledged}
            variant="destructive"
            size="lg"
            onClick={logOut}
          >
            Log out
          </Button>
        }
      />
      {removalFailed ? (
        <FieldMessage error role="alert">
          Could not log out. Please try again.
        </FieldMessage>
      ) : null}
    </RecoveryScreen>
  );
}
