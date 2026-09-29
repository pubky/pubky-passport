import { isKeyProtected, keyBackup } from "@/client/logic/local-identity/keyBackup";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { BackupStatusLine, formatBackupDate } from "@/client/ui/identity-dashboard/backupStatus";
import { identityDisplayName, unnamedKey } from "@/client/ui/shared/identityDisplay";
import {
  CheckIcon,
  DownloadIcon,
  KeyRoundIcon,
  SettingsIcon,
  SquareUserRoundIcon,
} from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { KeyCustodyTag } from "@/client/ui/shared/keyCustodyTag";
import { Avatar } from "@/client/ui/shared/primitives/avatar";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";

function IdentityOverview({
  identity,
  onAuthorize,
  onBackup,
  onManage,
  onSetUpProfile,
  onSwitch,
}: {
  identity: LocalIdentityMetadata;
  onAuthorize: () => void;
  /** Opens a new backup file, or with `check` the check of one made earlier. */
  onBackup: (check: boolean) => void;
  onManage: () => void;
  /** Opens the profile editor; offered while the identity's public profile is not set up. */
  onSetUpProfile: () => void;
  onSwitch: () => void;
}) {
  const backup = keyBackup(identity);
  // A browser key nothing is known to bring back is one cleared site away from being lost: say
  // so where the person lands, with the fix one tap away.
  const backupDue = !isKeyProtected(identity);
  // The main card is the Pubky profile; Google only appears as the attached-account tag.
  const name = identityDisplayName(identity);
  const publicKey = identity.publicIdentity.publicKeyZ32;

  return (
    <PassportScreen className="gap-6 md:gap-8">
      <DisplayHeading accent="pubky." aria-label="Your pubky." className="[&>span]:inline">
        Your{" "}
      </DisplayHeading>
      <section
        aria-label="Selected identity"
        className="grid grid-cols-2 gap-x-3 gap-y-6 rounded-2xl bg-card px-6 pb-6 pt-12 md:p-12"
      >
        <div className="col-span-2 flex w-full min-w-0 flex-col items-center gap-6 md:flex-row md:items-start">
          <Avatar
            fallback={name}
            size="lg"
            src={identity.avatarUrl ?? undefined}
            unnamedKey={unnamedKey(identity)}
          />
          <div className="flex w-full min-w-0 flex-col items-center gap-3 text-center md:max-w-69 md:flex-1 md:items-start md:gap-0 md:text-left">
            <h2 className="w-full text-2xl font-bold leading-8 [overflow-wrap:anywhere]">{name}</h2>
            <p className="w-full break-all text-xs font-medium leading-4 tracking-[0.1em] text-muted-foreground md:text-left">
              {publicKey}
            </p>
            {/* Where the key lives, in the tag every list and the review use. */}
            <div className="flex w-full min-w-0 justify-center pt-3 md:justify-start">
              <KeyCustodyTag identity={identity} />
            </div>
            {/* A key that needs a backup gets one warning: the notice below, not a line here. */}
            {backup.kind === "google" ? (
              <BackupStatusLine className="pt-2 text-muted-foreground" tone="ok">
                Key in this browser, backed up to Google Drive
              </BackupStatusLine>
            ) : backup.kind === "file" && !backupDue ? (
              <BackupStatusLine className="pt-2 text-muted-foreground" tone="ok">
                {`Recovery file checked ${formatBackupDate(backup.at)}`}
              </BackupStatusLine>
            ) : null}
          </div>
        </div>
        {backupDue ? (
          <Notice className="col-span-2" tone="warning">
            <p>
              {backup.kind === "file"
                ? `Passport made a recovery file on ${formatBackupDate(backup.at)}, but it was never checked. Check that it opens, so you know it can bring this pubky back.`
                : "This key is saved only in this browser. Download a recovery file so you can get this pubky back if this browser’s data is cleared."}
            </p>
            <div className="flex flex-wrap gap-3">
              {backup.kind === "file" ? (
                <Button onClick={() => onBackup(true)} variant="secondary">
                  <CheckIcon /> Check recovery file
                </Button>
              ) : null}
              <Button onClick={() => onBackup(false)} variant="secondary">
                <DownloadIcon /> Download recovery file
              </Button>
            </div>
          </Notice>
        ) : null}
        {identity.profileSetupRequired ? (
          <div className="col-span-2 flex flex-col items-center gap-3 rounded-lg bg-muted/40 p-4 text-center text-sm leading-5 text-secondary-foreground md:flex-row md:justify-between md:text-left">
            <p role="status">Your public profile isn&apos;t set up yet.</p>
            <Button onClick={onSetUpProfile} size="sm" variant="secondary">
              <SquareUserRoundIcon /> Set up profile
            </Button>
          </div>
        ) : null}
        <Button
          aria-label="Authorize an app"
          className="col-span-2 w-full"
          onClick={onAuthorize}
          size="lg"
          variant="secondary"
        >
          <KeyRoundIcon /> Authorize
        </Button>
        <Button
          aria-label="Manage identity"
          className="w-full"
          onClick={onManage}
          variant="secondary"
        >
          <SettingsIcon />
          Manage
        </Button>
        <Button
          aria-label="Switch identity"
          className="w-full"
          onClick={onSwitch}
          variant="secondary"
        >
          <SquareUserRoundIcon />
          Switch
        </Button>
      </section>
    </PassportScreen>
  );
}

export { IdentityOverview };
