import { useState } from "react";

import { isKeyProtected, keyBackupFile } from "@/client/logic/local-identity/keyBackup";
import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityHomeserverRepublishResult } from "@/client/logic/local-identity/LocalIdentityController";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { PubkyHomeserverResolutionResult } from "@/client/logic/pubky/pubkyIdentityKey";
import { BackupStatusLine, formatBackupDate } from "@/client/ui/identity-dashboard/backupStatus";
import { BackButton } from "@/client/ui/shared/backButton";
import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import { DetailField } from "@/client/ui/shared/detailField";
import { shortCopiedValue } from "@/client/ui/shared/formatPublicKey";
import { GoogleAccountTag } from "@/client/ui/shared/googleAccountTag";
import {
  CheckIcon,
  DownloadIcon,
  KeyRoundIcon,
  LinkOffIcon,
  LogOutIcon,
  SquareUserRoundIcon,
  TrashIcon,
} from "@/client/ui/shared/icons";
import { PassportHeaderAction } from "@/client/ui/shared/passportHeaderAction";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Avatar } from "@/client/ui/shared/primitives/avatar";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";
import { HomeserverRecord } from "./homeserverRecord";
import { IdentityProviderSection } from "./identityProviderSection";
import { LogoutConfirmation } from "./logoutConfirmation";

function IdentityManagement({
  identity,
  confirmLogout = false,
  onBack,
  onEditProfile,
  onBackupToGoogle,
  onDetachFromGoogle,
  onDownloadRecoveryFile,
  onRemoveLocalIdentity,
  onMigrateToKeychain,
  republishHomeserver,
  resolveHomeserver,
  providerHomeserver,
}: {
  identity: LocalIdentityMetadata;
  /** Opens on the logout confirmation, e.g. when returning from the backup it asked for. */
  confirmLogout?: boolean;
  onBack: () => void;
  onEditProfile?: () => void;
  /** Offered only when Google is available; its presence is the only switch. */
  onBackupToGoogle?: () => void;
  onDetachFromGoogle: () => void;
  /**
   * `returnTo` names the screen to come back to once the backup is done; `check` only checks a
   * backup file made earlier.
   */
  onDownloadRecoveryFile: (returnTo: "manage" | "logout", check?: boolean) => void;
  onRemoveLocalIdentity: () => LocalIdentityResult<void>;
  onMigrateToKeychain: () => void;
  republishHomeserver: (
    publicKeyZ32: string,
    homeserverPubky: string,
  ) => Promise<LocalIdentityHomeserverRepublishResult>;
  /** Repairs a missing `_pubky` record of an identity that does not remember its homeserver. */
  providerHomeserver?: string | undefined;
  resolveHomeserver: (publicKeyZ32: string) => Promise<PubkyHomeserverResolutionResult>;
}) {
  const [confirmingLogout, setConfirmingLogout] = useState(confirmLogout);
  const account = identity.googleAccount;
  const publicKeyZ32 = identity.publicIdentity.publicKeyZ32;
  const name = identity.profile?.name ?? "Your Pubky";
  // A Ring-held key never reaches Passport, so it cannot be backed up or signed with here.
  const browserKey = identity.keySource !== "ring";
  const backupFile = keyBackupFile(identity);
  const uncheckedFile = backupFile !== undefined && !backupFile.verified;
  // Leaving this browser may delete the only copy of a key nothing is known to bring back: a file
  // Passport made but never saw open may not exist.
  const unbacked = !isKeyProtected(identity);
  // The accessible name starts with the visible text, so "Remove key" also works by voice.
  const leaveLabel = unbacked ? "Remove key from this browser" : "Log out";

  if (confirmingLogout)
    return (
      <LogoutConfirmation
        identity={identity}
        onCancel={() => setConfirmingLogout(false)}
        onCheckBackup={() => onDownloadRecoveryFile("logout", true)}
        onDownloadBackup={() => onDownloadRecoveryFile("logout")}
        onRemoveIdentity={onRemoveLocalIdentity}
        onRemoved={onBack}
      />
    );

  return (
    <PassportScreen width="wide" className="gap-6">
      <PassportHeaderAction>
        <Button
          aria-label={leaveLabel}
          title={leaveLabel}
          className="size-10 p-0 min-[375px]:w-auto min-[375px]:px-4"
          onClick={() => setConfirmingLogout(true)}
          variant="secondary"
        >
          {unbacked ? <TrashIcon /> : <LogOutIcon />}
          <span className="hidden min-[375px]:inline">{unbacked ? "Remove key" : "Log out"}</span>
        </Button>
      </PassportHeaderAction>
      <DisplayHeading accent="identity." aria-label="Manage identity.">
        Manage
      </DisplayHeading>
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="manage-profile"
          className="flex min-w-0 flex-col items-start gap-6 rounded-lg bg-card p-6 md:p-8 xl:p-12"
        >
          <h2 id="manage-profile" className="text-2xl font-bold">
            Public profile
          </h2>
          <div className="flex min-w-0 items-center gap-4">
            <Avatar
              fallback={name}
              src={identity.avatarUrl ?? undefined}
              className="size-16 shrink-0"
            />
            <p className="min-w-0 break-words text-xl font-bold">{name}</p>
          </div>
          {identity.profile?.bio ? (
            <p className="break-words text-sm leading-5 text-secondary-foreground">
              {identity.profile.bio}
            </p>
          ) : null}
          <DetailField
            copy={{
              value: publicKeyZ32,
              copied: "Pubky copied to clipboard",
              copiedDescription: shortCopiedValue(publicKeyZ32),
              failed: "Could not copy pubky",
              failedDescription: "Select and copy your pubky manually.",
            }}
            label="Pubky"
            value={publicKeyZ32}
          />
          <HomeserverRecord
            providerHomeserver={providerHomeserver}
            publicKeyZ32={publicKeyZ32}
            registeredHomeserver={identity.homeserverPubky}
            resolveHomeserver={resolveHomeserver}
            {...(browserKey ? { republishHomeserver } : {})}
          />
          {onEditProfile ? (
            <Button onClick={onEditProfile} variant="secondary">
              <SquareUserRoundIcon /> Edit profile
            </Button>
          ) : null}
        </section>
        <section
          aria-labelledby="manage-keys"
          className="flex min-w-0 flex-col items-start gap-6 rounded-lg bg-card p-6 md:p-8 xl:p-12"
        >
          <h2 id="manage-keys" className="text-2xl font-bold">
            Backup & key access
          </h2>
          <p className="text-sm leading-5 text-secondary-foreground">
            {!browserKey
              ? "Your private key stays in Pubky Ring. Manage its backup in Ring."
              : account
                ? "Your key is saved in this browser and backed up, encrypted, to Google Drive. For a copy that doesn’t depend on Google, download a backup file or use Pubky Ring."
                : "Your key is saved only in this browser. Keep an encrypted backup file so you can restore it if this browser’s data is cleared or you switch devices."}
          </p>
          {backupFile?.verified ? (
            <BackupStatusLine tone="ok">
              Backup file checked on {formatBackupDate(backupFile.at)}.
            </BackupStatusLine>
          ) : backupFile ? (
            <BackupStatusLine tone="warning">
              Passport made a backup file on {formatBackupDate(backupFile.at)}, but it was never
              checked.
            </BackupStatusLine>
          ) : unbacked ? (
            <BackupStatusLine tone="warning">
              No backup yet. If this browser’s data is cleared, this pubky is lost.
            </BackupStatusLine>
          ) : null}
          {browserKey ? (
            <div className="flex w-full flex-wrap gap-3">
              {/* A file already made is quicker to check than a new one is to make and check. */}
              {uncheckedFile ? (
                <Button
                  onClick={() => onDownloadRecoveryFile("manage", true)}
                  variant={unbacked ? "default" : "secondary"}
                >
                  <CheckIcon /> Check backup
                </Button>
              ) : null}
              <Button
                onClick={() => onDownloadRecoveryFile("manage")}
                variant={unbacked && !uncheckedFile ? "default" : "secondary"}
              >
                <DownloadIcon /> Download backup
              </Button>
              <Button onClick={onMigrateToKeychain} variant="secondary">
                <KeyRoundIcon /> Use in Pubky Ring
              </Button>
            </div>
          ) : null}
          {account || (browserKey && onBackupToGoogle) ? (
            <IdentityProviderSection name="Google account">
              {account ? (
                <>
                  <GoogleAccountTag account={account} />
                  <p className="text-sm leading-5 text-secondary-foreground">
                    Use this Google account to sign in to Passport and restore your encrypted
                    identity.
                  </p>
                  <Button onClick={onDetachFromGoogle} variant="outline">
                    <LinkOffIcon /> Detach from Google
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm leading-5 text-secondary-foreground">
                    Attach a Google account to sign in with Google and keep an encrypted backup in
                    your Google Drive.
                  </p>
                  <Button onClick={onBackupToGoogle} variant="secondary">
                    <GoogleLogo /> Attach to Google
                  </Button>
                </>
              )}
            </IdentityProviderSection>
          ) : null}
        </section>
      </div>
      <PassportNavigation back={<BackButton onClick={onBack} />} />
    </PassportScreen>
  );
}

export { IdentityManagement };
