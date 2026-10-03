import { type ReactNode, useId, useState } from "react";

import {
  isKeyProtected,
  keyBackupFile,
  latestBackupVerification,
  type BackupVerification,
  type KeyBackupFile,
} from "@/client/logic/local-identity/keyBackup";
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
  PencilIcon,
  TrashIcon,
} from "@/client/ui/shared/icons";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { ProfileLinks } from "@/client/ui/profile/profileLinks";
import { Avatar } from "@/client/ui/shared/primitives/avatar";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";
import { GoogleAccountRow } from "./googleAccountRow";
import { HomeserverRecord } from "./homeserverRecord";
import { IdentityProviderSection } from "./identityProviderSection";
import { LogoutConfirmation } from "./logoutConfirmation";

/**
 * Manage identity, for an identity whose key this browser holds: its profile and homeserver
 * record, and its backups and way out. A key in Pubky Ring has no such screen; its overview offers
 * its profile and Remove from this browser.
 */
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
  onVerifyBackup,
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
  /** `returnTo` names the screen to come back to once the backup is done. */
  onDownloadRecoveryFile: (returnTo: "manage" | "logout") => void;
  onRemoveLocalIdentity: () => LocalIdentityResult<void>;
  onMigrateToKeychain: () => void;
  /**
   * Opens Verify your backup, where a recovery file or Pubky Ring's copy is checked; with
   * `"logout"` its Back returns to the removal confirmation that asked for it.
   */
  onVerifyBackup: (returnTo?: "logout") => void;
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
  const backupFile = keyBackupFile(identity);
  // Leaving this browser may delete the only copy of a key nothing is known to bring back: a file
  // Passport made but never saw open may not exist.
  const unbacked = !isKeyProtected(identity);
  // One action leaves this browser. It sits with the backups it depends on, after them in their
  // card. (A key in Pubky Ring has no Manage screen: its overview offers the same action.)
  const remove = (
    <Button onClick={() => setConfirmingLogout(true)} variant="secondary">
      {unbacked ? <TrashIcon /> : <LogOutIcon />}
      Remove from this browser
    </Button>
  );

  if (confirmingLogout)
    return (
      <LogoutConfirmation
        identity={identity}
        onCancel={() => setConfirmingLogout(false)}
        onCheckBackup={() => onVerifyBackup("logout")}
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
          {/* The profile's own action ends the row that names it; where the row is too narrow it
              wraps under the name, still before the bio. */}
          <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar
                className="size-16 shrink-0"
                profileName={profileName(identity)}
                publicKey={publicKeyZ32}
                src={identity.avatarUrl ?? undefined}
              />
              <div className="flex min-w-0 flex-col items-start gap-1">
                <p className="min-w-0 max-w-full break-words text-xl font-bold">{name}</p>
              </div>
            </div>
            {onEditProfile ? (
              <Button className="shrink-0" onClick={onEditProfile} variant="secondary">
                <PencilIcon />
                {identity.profileSetupRequired ? "Set up profile" : "Edit profile"}
              </Button>
            ) : null}
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
            republishHomeserver={republishHomeserver}
          />
        </section>
        <KeyAccess
          account={account}
          backupFile={backupFile}
          onBackupToGoogle={onBackupToGoogle}
          onDetachFromGoogle={onDetachFromGoogle}
          onDownloadRecoveryFile={onDownloadRecoveryFile}
          onMigrateToKeychain={onMigrateToKeychain}
          onVerifyBackup={onVerifyBackup}
          remove={remove}
          unbacked={unbacked}
          verification={latestBackupVerification(identity)}
        />
      </div>
      <PassportNavigation back={<BackButton onClick={onBack} />} />
    </PassportScreen>
  );
}

/**
 * Backups and the other places a key saved in this browser can live: making a backup, verifying
 * one, the Google account, and, set apart at the end, removing the key from this browser.
 */
function KeyAccess({
  account,
  backupFile,
  onBackupToGoogle,
  onDetachFromGoogle,
  onDownloadRecoveryFile,
  onMigrateToKeychain,
  onVerifyBackup,
  remove,
  unbacked,
  verification,
}: {
  account: LocalIdentityMetadata["googleAccount"];
  backupFile: KeyBackupFile | undefined;
  onBackupToGoogle?: (() => void) | undefined;
  onDetachFromGoogle: () => void;
  onDownloadRecoveryFile: (returnTo: "manage" | "logout") => void;
  onMigrateToKeychain: () => void;
  onVerifyBackup: () => void;
  /** Removes the identity from this browser: the last of the key's own actions. */
  remove: ReactNode;
  unbacked: boolean;
  /** The most recent check of a backup, of either kind. */
  verification: BackupVerification | undefined;
}) {
  const uncheckedFile = backupFile !== undefined && !backupFile.verified;
  return (
    <section
      aria-labelledby="manage-keys"
      className="flex min-w-0 flex-col items-start gap-6 rounded-lg bg-card p-6 md:p-8 xl:p-12"
    >
      <h2 id="manage-keys" className="text-2xl font-bold">
        Backup & key access
      </h2>
      <p className="text-sm leading-5 text-secondary-foreground">
        {account
          ? "Your key is saved in this browser and backed up, encrypted, to Google Drive. For a copy that doesn’t depend on Google, download a recovery file or use Pubky Ring."
          : "Your key is saved only in this browser. Keep a recovery file so you can restore it if this browser’s data is cleared or you switch devices."}
      </p>
      {/* A verified backup is dated in the Verify section below. */}
      {uncheckedFile && !verification ? (
        <BackupStatusLine tone="warning">
          Passport made a recovery file on {formatBackupDate(backupFile.at)}, but it was never
          checked.
        </BackupStatusLine>
      ) : unbacked && !backupFile ? (
        <BackupStatusLine tone="warning">
          No backup yet. If this browser’s data is cleared, this pubky is lost.
        </BackupStatusLine>
      ) : null}
      <KeyAccessGroup title="Back up">
        {/* Both ways to back up, in one row and one style; only a backup that is due takes the
            filled brand button. */}
        <div className="flex w-full flex-wrap gap-3">
          <Button onClick={onMigrateToKeychain} variant="secondary">
            <KeyRoundIcon /> Migrate to Pubky Ring
          </Button>
          <Button
            onClick={() => onDownloadRecoveryFile("manage")}
            variant={unbacked && !uncheckedFile ? "default" : "secondary"}
          >
            <DownloadIcon /> Download recovery file
          </Button>
        </div>
      </KeyAccessGroup>
      <KeyAccessGroup title="Verify">
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
          {/* A file already made is quicker to check than a new one is to make and check. */}
          <Button
            onClick={() => onVerifyBackup()}
            variant={unbacked && uncheckedFile ? "default" : "secondary"}
          >
            <CheckIcon /> Verify backup
          </Button>
          <p className="text-sm leading-5 text-secondary-foreground">
            {verification
              ? `Last verified ${formatBackupDate(verification.at)} (${
                  verification.method === "ring" ? "Pubky Ring" : "Recovery file"
                })`
              : "Never verified"}
          </p>
        </div>
      </KeyAccessGroup>
      {account || onBackupToGoogle ? (
        <IdentityProviderSection name="Google account">
          {account ? (
            <GoogleAccountRow account={account} onDetach={onDetachFromGoogle} />
          ) : (
            <>
              <p className="text-sm leading-5 text-secondary-foreground">
                Attach a Google account to sign in with Google and keep an encrypted backup in your
                Google Drive.
              </p>
              <Button onClick={onBackupToGoogle} variant="secondary">
                <GoogleLogo /> Attach to Google
              </Button>
            </>
          )}
        </IdentityProviderSection>
      ) : null}
      {/* Set apart, so it never reads as one of the backup actions. */}
      <div className="w-full border-t border-border pt-6" data-slot="remove">
        {remove}
      </div>
    </section>
  );
}

/** A small titled group of the key card's actions. */
function KeyAccessGroup({ children, title }: { children: ReactNode; title: string }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className="flex w-full min-w-0 flex-col items-start gap-3">
      <h3 className="text-sm font-bold leading-5 text-foreground" id={heading}>
        {title}
      </h3>
      {children}
    </section>
  );
}

export { IdentityManagement };
