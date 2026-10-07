import { useState } from "react";

import { isKeyProtected, keyBackup } from "@/client/logic/local-identity/keyBackup";
import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { LogoutConfirmation } from "@/client/ui/identity-dashboard/management/logoutConfirmation";
import { formatBackupDate } from "@/client/ui/identity-dashboard/backupStatus";
import { BALANCED_KEY_CLASS, BalancedKeyText } from "@/client/ui/shared/balancedKey";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { identityDisplayName, profileName } from "@/client/ui/shared/identityDisplay";
import {
  CheckIcon,
  DownloadIcon,
  KeyRoundIcon,
  LogOutIcon,
  PencilIcon,
  SettingsIcon,
  SquareUserRoundIcon,
} from "@/client/ui/shared/icons";
import { KeyCustodyTag } from "@/client/ui/shared/keyCustodyTag";
import { Notice } from "@/client/ui/shared/notice";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Avatar } from "@/client/ui/shared/primitives/avatar";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";

/**
 * The selected identity's home. One whose key this browser holds signs apps in from here
 * (Authorize) and is managed from here (Manage). One whose key stays in Pubky Ring is in Passport
 * for its profile only, so its main action is the profile editor, nothing here signs or handles
 * the key, and its one other action, Remove from this browser, takes Manage's place: it has
 * nothing else to manage (as Log out, short enough for a phone's half row).
 */
function IdentityOverview({
  identity,
  keychainConnected = false,
  onAuthorize,
  onBackup,
  onDisconnectKeychain,
  onEditProfile,
  onManage,
  onVerifyBackup,
  onRemoveIdentity,
  onRemoved,
  onSwitch,
}: {
  identity: LocalIdentityMetadata;
  /** A Ring identity's profile grant is stored in this browser, so editing needs no new approval. */
  keychainConnected?: boolean;
  onAuthorize: () => void;
  /** Opens a new recovery file. */
  onBackup: () => void;
  /** Revokes that stored grant; the next profile edit asks the keychain again. */
  onDisconnectKeychain?: (() => void) | undefined;
  /** Opens the profile editor, which sets up a public profile that does not exist yet. */
  onEditProfile: () => void;
  onManage: () => void;
  /** Opens Verify your backup, where a file made earlier is checked. */
  onVerifyBackup: () => void;
  /** Removes a Ring identity from this browser, once its confirmation is accepted. */
  onRemoveIdentity: () => LocalIdentityResult<void>;
  /** Where the page goes once the identity is removed. */
  onRemoved: () => void;
  onSwitch: () => void;
}) {
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const heldInRing = identity.keySource === "ring";
  const backup = keyBackup(identity);
  // A browser key nothing is known to bring back is one cleared site away from being lost: say
  // so where the person lands, with the fix one tap away.
  const backupDue = !isKeyProtected(identity);
  // When the backup was last checked is Manage's to show; this card warns only when one is due.
  // The main card is the Pubky profile; Google only appears as the attached-account tag.
  const name = identityDisplayName(identity);
  const publicKey = identity.publicIdentity.publicKeyZ32;

  // The same confirmation as a browser key's Manage offers; Cancel returns here.
  if (confirmingRemoval)
    return (
      <LogoutConfirmation
        identity={identity}
        onCancel={() => setConfirmingRemoval(false)}
        onCheckBackup={onVerifyBackup}
        onDownloadBackup={onBackup}
        onRemoveIdentity={onRemoveIdentity}
        onRemoved={onRemoved}
      />
    );

  return (
    <PassportScreen className="gap-6 md:gap-8">
      <DisplayHeading accent="pubky." aria-label="Your pubky." className="[&>span]:inline">
        Your{" "}
      </DisplayHeading>
      {/* One card across the track: from lg the identity (with what it still needs) on the left
          and its actions in a column of their own on the right, so no button runs the card's
          width; stacked below lg. */}
      <section
        aria-label="Selected identity"
        className="flex flex-col gap-6 rounded-2xl bg-card px-6 pb-6 pt-12 md:p-12 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-x-12"
      >
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex w-full min-w-0 flex-col items-center gap-6 md:flex-row md:items-start">
            <Avatar
              profileName={profileName(identity)}
              publicKey={publicKey}
              size="lg"
              src={identity.avatarUrl ?? undefined}
            />
            <div className="flex w-full min-w-0 flex-col items-center gap-3 text-center md:max-w-69 md:flex-1 md:items-start md:gap-0 md:text-left">
              <h2 className="w-full text-2xl font-bold leading-8 [overflow-wrap:anywhere]">
                {name}
              </h2>
              <p
                className={cn(
                  "w-full text-xs font-medium leading-4 tracking-[0.1em] text-muted-foreground md:text-left",
                  BALANCED_KEY_CLASS,
                )}
              >
                <BalancedKeyText value={publicKey} />
              </p>
              {/* A Google or Pubky Ring key gets the tag every list uses; a key only in this
                browser gets none. */}
              <KeyCustodyTag className="mt-3" identity={identity} showGoogle={false} />
            </div>
          </div>
          {backupDue ? (
            <Notice tone="warning">
              <p>
                {backup.kind === "file"
                  ? `Passport made a recovery file on ${formatBackupDate(backup.at)}, but it was never checked. Check that it opens, so you know it can bring this pubky back.`
                  : "This key is saved only in this browser. Download a recovery file so you can get this pubky back if this browser’s data is cleared."}
              </p>
              <div className="flex flex-wrap gap-3">
                {backup.kind === "file" ? (
                  <Button onClick={onVerifyBackup} variant="secondary">
                    <CheckIcon /> Check recovery file
                  </Button>
                ) : null}
                <Button onClick={onBackup} variant="secondary">
                  <DownloadIcon /> Download recovery file
                </Button>
              </div>
            </Notice>
          ) : null}
          {identity.profileSetupRequired ? (
            <div className="flex flex-col items-center gap-3 rounded-lg bg-muted/40 p-4 text-center text-sm leading-5 text-secondary-foreground md:flex-row md:justify-between md:text-left">
              <p role="status">Your public profile isn&apos;t set up yet.</p>
              {/* A Ring identity's main action below is this same one. */}
              {heldInRing ? null : (
                <Button onClick={onEditProfile} size="sm" variant="secondary">
                  <PencilIcon /> Set up profile
                </Button>
              )}
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 lg:gap-y-3">
          {heldInRing ? (
            <Button
              className="col-span-2 w-full"
              onClick={onEditProfile}
              size="lg"
              variant="secondary"
            >
              <PencilIcon />
              {identity.profileSetupRequired ? "Set up profile" : "Edit profile"}
            </Button>
          ) : (
            <Button
              aria-label="Authorize an app"
              className="col-span-2 w-full"
              onClick={onAuthorize}
              size="lg"
              variant="secondary"
            >
              <KeyRoundIcon /> Authorize
            </Button>
          )}
          {heldInRing ? (
            // Short beside Switch, as Manage is for a browser key, so it fits a phone's half row; its
            // confirmation says what it does (Remove this identity from this browser?).
            <Button
              className="w-full"
              onClick={() => setConfirmingRemoval(true)}
              variant="secondary"
            >
              <LogOutIcon />
              Log out
            </Button>
          ) : (
            <Button
              aria-label="Manage identity"
              className="w-full"
              onClick={onManage}
              variant="secondary"
            >
              <SettingsIcon />
              Manage
            </Button>
          )}
          <Button
            aria-label="Switch identity"
            className="w-full"
            onClick={onSwitch}
            variant="secondary"
          >
            <SquareUserRoundIcon />
            Switch
          </Button>
        </div>
      </section>
      {heldInRing && keychainConnected && onDisconnectKeychain ? (
        // Passport keeps its profile connection to the keychain; this ends it on the homeserver.
        <p className="text-sm leading-5 pointer-coarse:-my-1.5">
          <Button onClick={onDisconnectKeychain} variant="link">
            Disconnect keychain
          </Button>
        </p>
      ) : null}
    </PassportScreen>
  );
}

export { IdentityOverview };
