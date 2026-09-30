import { useState } from "react";

import { isKeyProtected, keyBackupFile } from "@/client/logic/local-identity/keyBackup";
import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityHomeserverRepublishResult } from "@/client/logic/local-identity/LocalIdentityController";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { PubkyHomeserverResolutionResult } from "@/client/logic/pubky/pubkyIdentityKey";
import { BackupStatusLine, formatBackupDate } from "@/client/ui/identity-dashboard/backupStatus";
import { BackButton } from "@/client/ui/shared/backButton";
import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import { PUBKY_COPY_TOASTS } from "@/client/ui/shared/copyToClipboard";
import { DetailField } from "@/client/ui/shared/detailField";
import { shortCopiedValue } from "@/client/ui/shared/formatPublicKey";
import { identityDisplayName, profileName } from "@/client/ui/shared/identityDisplay";
import {
  CheckIcon,
  DownloadIcon,
  KeyRoundIcon,
  LogOutIcon,
  SquareUserRoundIcon,
  TrashIcon,
} from "@/client/ui/shared/icons";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { ProfileLinks } from "@/client/ui/profile/profileLinks";
import { KeyCustodyTag } from "@/client/ui/shared/keyCustodyTag";
import { Avatar } from "@/client/ui/shared/primitives/avatar";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";
import { GoogleAccountRow } from "./googleAccountRow";
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
  const name = identityDisplayName(identity);
  // A Ring-held key never reaches Passport, so it cannot be backed up or signed with here.
  const browserKey = identity.keySource !== "ring";
  const backupFile = keyBackupFile(identity);
  const uncheckedFile = backupFile !== undefined && !backupFile.verified;
  // Leaving this browser may delete the only copy of a key nothing is known to bring back: a file
  // Passport made but never saw open may not exist.
  const unbacked = !isKeyProtected(identity);
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
              className="size-16 shrink-0"
              profileName={profileName(identity)}
              publicKey={publicKeyZ32}
              src={identity.avatarUrl ?? undefined}
            />
            <div className="flex min-w-0 flex-col items-start gap-1">
              <p className="min-w-0 max-w-full break-words text-xl font-bold">{name}</p>
              <KeyCustodyTag identity={identity} showGoogle={false} />
            </div>
          </div>
          {identity.profile?.bio ? (
            <p className="break-words text-sm leading-5 text-secondary-foreground">
              {identity.profile.bio}
            </p>
          ) : null}
          <ProfileLinks links={identity.profile?.links} />
          <DetailField
            copy={{
              ...PUBKY_COPY_TOASTS,
              value: publicKeyZ32,
              copiedDescription: shortCopiedValue(publicKeyZ32),
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
          <div className="flex w-full flex-wrap gap-3">
            {onEditProfile ? (
              <Button onClick={onEditProfile} variant="secondary">
                <SquareUserRoundIcon />{" "}
                {identity.profileSetupRequired ? "Set up profile" : "Edit profile"}
              </Button>
            ) : null}
            {/* The accessible name starts with the visible text, so it also works by voice. */}
            <Button onClick={() => setConfirmingLogout(true)} variant="secondary">
              {unbacked ? <TrashIcon /> : <LogOutIcon />}
              {leaveLabel}
            </Button>
          </div>
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
              ? "Your private key stays in Pubky Ring. Manage its backup in Pubky Ring."
              : account
                ? "Your key is saved in this browser and backed up, encrypted, to Google Drive. For a copy that doesn’t depend on Google, download a recovery file or use Pubky Ring."
                : "Your key is saved only in this browser. Keep a recovery file so you can restore it if this browser’s data is cleared or you switch devices."}
          </p>
          {/* A checked file is dated next to "Check recovery file" below. */}
          {backupFile?.verified ? null : backupFile ? (
            <BackupStatusLine tone="warning">
              Passport made a recovery file on {formatBackupDate(backupFile.at)}, but it was never
              checked.
            </BackupStatusLine>
          ) : unbacked ? (
            <BackupStatusLine tone="warning">
              No backup yet. If this browser’s data is cleared, this pubky is lost.
            </BackupStatusLine>
          ) : null}
          {browserKey ? (
            // Checking stays available on its own row, with when a file of this key last opened.
            <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
              {/* A file already made is quicker to check than a new one is to make and check. */}
              <Button
                onClick={() => onDownloadRecoveryFile("manage", true)}
                variant={unbacked && uncheckedFile ? "default" : "secondary"}
              >
                <CheckIcon /> Check recovery file
              </Button>
              <p className="text-sm leading-5 text-secondary-foreground">
                {backupFile?.verified
                  ? `Last checked ${formatBackupDate(backupFile.at)}`
                  : "Never checked"}
              </p>
            </div>
          ) : null}
          {browserKey ? (
            <div className="flex w-full flex-wrap gap-3">
              <Button
                onClick={() => onDownloadRecoveryFile("manage")}
                variant={unbacked && !uncheckedFile ? "default" : "secondary"}
              >
                <DownloadIcon /> Download recovery file
              </Button>
              <Button onClick={onMigrateToKeychain} variant="secondary">
                <KeyRoundIcon /> Use in Pubky Ring
              </Button>
            </div>
          ) : null}
          {account || (browserKey && onBackupToGoogle) ? (
            <IdentityProviderSection name="Google account">
              {account ? (
                <GoogleAccountRow account={account} onDetach={onDetachFromGoogle} />
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
