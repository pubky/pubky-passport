import { Result } from "better-result";
import { useState, type ReactNode } from "react";

import { isKeyProtected, keyBackup } from "@/client/logic/local-identity/keyBackup";
import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { formatBackupDate } from "@/client/ui/identity-dashboard/backupStatus";
import { CheckIcon, DownloadIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Button } from "@/client/ui/shared/primitives/button";
import { RecoveryScreen } from "@/client/ui/shared/recoveryScreen";

const STAYS_ONLINE =
  "Your public profile stays online, and apps you already signed in to stay signed in until you sign out there.";

/**
 * Confirms removing an identity from this browser. A browser key nothing is known to bring back
 * (no backup, or only a file Passport made but never saw open) is "removed", not logged out of,
 * because this may delete its only copy. The backup acknowledgement and any failure live here, so
 * cancelling (which unmounts this screen) always starts the next attempt fresh.
 */
export function LogoutConfirmation({
  identity,
  onCancel,
  onCheckBackup,
  onDownloadBackup,
  onRemoveIdentity,
  onRemoved,
}: {
  identity: LocalIdentityMetadata;
  onCancel: () => void;
  onCheckBackup: () => void;
  onDownloadBackup: () => void;
  onRemoveIdentity: () => LocalIdentityResult<void>;
  onRemoved: () => void;
}) {
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
  const [removalFailed, setRemovalFailed] = useState(false);
  const backup = keyBackup(identity);
  const removesOnlyCopy = !isKeyProtected(identity);
  // Passport cannot see a backup file, which may be gone by now: its owner confirms having it.
  const needsAcknowledgement = removesOnlyCopy || backup.kind === "file";

  function logOut(): void {
    if (Result.isError(onRemoveIdentity())) {
      setRemovalFailed(true);
      return;
    }
    onRemoved();
  }

  let description: ReactNode;
  switch (backup.kind) {
    case "ring":
      description = `This removes the saved identity from this browser. Your key stays in Pubky Ring, so you can add this pubky again from Ring. ${STAYS_ONLINE}`;
      break;
    case "google":
      description = (
        <>
          This deletes the key saved in this browser. To use this pubky again, choose Continue with
          Google and sign in as <span className="break-all">{backup.email}</span>. {STAYS_ONLINE}
        </>
      );
      break;
    default:
      description = `This deletes the private key saved in this browser. ${STAYS_ONLINE}`;
  }

  return (
    <RecoveryScreen
      title={removesOnlyCopy ? "Remove this key from this browser?" : "Log out of this identity?"}
      description={description}
    >
      <div className="min-w-0">
        <p className="break-words font-bold">{identity.profile?.name ?? "Your Pubky"}</p>
        <p className="break-all text-sm text-secondary-foreground">
          {identity.publicIdentity.publicKeyZ32}
        </p>
      </div>
      {backup.kind === "none" ? (
        <Notice tone="warning">
          <p>
            Passport has no backup of this key. Unless you saved one elsewhere, removing it deletes
            the only copy and this pubky is gone for good.
          </p>
          <Button onClick={onDownloadBackup}>
            <DownloadIcon /> Download backup
          </Button>
        </Notice>
      ) : null}
      {backup.kind === "file" && !backup.verified ? (
        <Notice tone="warning">
          <p>
            Passport made a backup file on {formatBackupDate(backup.at)}, but it was never checked.
            If that file is missing or doesn’t open, removing this key deletes the only copy and
            this pubky is gone for good.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={onCheckBackup}>
              <CheckIcon /> Check backup
            </Button>
            <Button onClick={onDownloadBackup} variant="secondary">
              <DownloadIcon /> Download backup
            </Button>
          </div>
        </Notice>
      ) : null}
      {backup.kind === "file" && backup.verified ? (
        <Notice tone="info">
          You checked a backup file of this key on {formatBackupDate(backup.at)}. Make sure you
          still have the file and its password.
        </Notice>
      ) : null}
      {needsAcknowledgement ? (
        <label className="flex items-start gap-3 text-sm leading-5">
          <input
            checked={backupAcknowledged}
            className="mt-0.5 size-4 shrink-0 accent-brand"
            onChange={(event) => setBackupAcknowledged(event.currentTarget.checked)}
            type="checkbox"
          />
          {removesOnlyCopy
            ? "I have a backup of this key and understand it will be deleted from this browser."
            : "I still have the backup file and know its password."}
        </label>
      ) : null}
      {removalFailed ? (
        <Notice tone="error">
          {removesOnlyCopy ? "Could not remove the key." : "Could not log out."} Nothing was
          deleted. Please try again.
        </Notice>
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
            disabled={needsAcknowledgement && !backupAcknowledged}
            variant="destructive"
            size="lg"
            onClick={logOut}
          >
            {removesOnlyCopy ? "Remove key" : "Log out"}
          </Button>
        }
      />
    </RecoveryScreen>
  );
}
