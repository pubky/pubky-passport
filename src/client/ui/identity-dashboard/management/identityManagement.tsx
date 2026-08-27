import { Result } from "better-result";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { LOGGER, safeErrorLogFields } from "../../../../libs/logger/logger";
import type { LocalIdentityResult } from "../../../logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityMetadata } from "../../../logic/local-identity/localIdentityModels";
import type { PubkyHomeserverResolutionResult } from "../../../logic/pubky/pubkyIdentityKey";
import { CopyIcon, DownloadIcon, KeyRoundIcon, LinkOffIcon, LogOutIcon } from "../../shared/actionIcons";
import { BackButton } from "../../shared/backButton";
import { PassportScreen } from "../../shared/passportScreen";
import { Avatar } from "../../shared/primitives/avatar";
import { Button } from "../../shared/primitives/button";
import { IconButton } from "../../shared/primitives/iconButton";
import { FieldMessage } from "../../shared/primitives/fieldMessage";
import { DisplayHeading } from "../../shared/primitives/typography";
import { showCopyConfirmation } from "../../shared/sonner";

function IdentityManagement({ identity, onBack, onDetachFromGoogle, onDownloadRecoveryFile, onRemoveLocalIdentity, onMigrateToKeychain, resolveHomeserver }: { identity: LocalIdentityMetadata; onBack: () => void; onDetachFromGoogle: () => void; onDownloadRecoveryFile: () => void; onRemoveLocalIdentity: () => LocalIdentityResult<void>; onMigrateToKeychain: () => void; resolveHomeserver: (publicKeyZ32: string) => Promise<PubkyHomeserverResolutionResult> }) {
  const account = identity.googleAccount;
  const name = account?.name ?? "Your Pubky";
  const [homeserver, setHomeserver] = useState<string | null | undefined>();
  const [logoutFailed, setLogoutFailed] = useState(false);

  function logout(): void {
    const removed = onRemoveLocalIdentity();
    if (Result.isError(removed)) {
      setLogoutFailed(true);
      return;
    }
    onBack();
  }

  useEffect(() => {
    let cancelled = false;
    void resolveHomeserver(identity.publicIdentity.publicKeyZ32)
      .then((result) => {
        if (!cancelled) setHomeserver(Result.isError(result) ? null : result.value);
      })
      .catch((cause: unknown) => {
        LOGGER.warn("identity.management.failed", {
          operation: "resolve_homeserver",
          ...safeErrorLogFields(cause),
        });
        if (!cancelled) setHomeserver(null);
      });
    return () => { cancelled = true; };
  }, [identity.publicIdentity.publicKeyZ32, resolveHomeserver]);

  return (
    <PassportScreen className="gap-6 md:gap-8">
      <header className="flex items-start gap-6 md:items-center">
        <DisplayHeading accent="identity." aria-label="Manage identity.">Manage</DisplayHeading>
        <Avatar className="ml-auto" fallback={name} size="lg" {...(account?.pictureUrl ? { src: account.pictureUrl } : {})} />
      </header>

      <section className="flex flex-col gap-6 md:grid md:grid-cols-2 md:gap-x-4 md:gap-y-6">
        <IdentityDetail label="User" value={name} />
        <IdentityDetail label="Google account" value={account?.email ?? "Not connected"} />
        <IdentityDetail copy label="Pubky" value={identity.publicIdentity.publicKeyZ32} />
        <IdentityDetail copy label="Homeserver" value={homeserver === undefined ? "Looking up…" : homeserver ?? "Unavailable"} />
      </section>

      <div className="mt-auto flex flex-col gap-4 pt-6 md:mt-0 md:flex-row md:flex-wrap md:gap-3 md:pt-0">
        {logoutFailed ? <FieldMessage error>Could not log out. Please try again.</FieldMessage> : null}
        <ManagementButton icon={<KeyRoundIcon />} onClick={onMigrateToKeychain}>Migrate to keychain</ManagementButton>
        <ManagementButton icon={<DownloadIcon />} onClick={onDownloadRecoveryFile}>Download recovery file</ManagementButton>
        {account ? <ManagementButton icon={<LinkOffIcon />} onClick={onDetachFromGoogle}>Detach from Google</ManagementButton> : null}
      </div>
      <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-[120px_1fr_228px] md:items-center md:gap-0 md:pt-1">
        <div className="w-full md:col-start-3 md:row-start-1">
          <Button className="w-full" onClick={logout} size="lg" variant="destructive"><LogOutIcon />Log out</Button>
        </div>
        <div className="w-full md:col-start-1 md:row-start-1">
          <BackButton onClick={onBack} />
        </div>
      </div>
    </PassportScreen>
  );
}

function IdentityDetail({ copy = false, label, value }: { copy?: boolean; label: string; value: string }) {
  const isCopyable = copy && value !== "Unavailable" && value !== "Looking up…";

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      showCopyConfirmation(label, value);
    } catch (cause) {
      LOGGER.info("identity.management.failed", {
        operation: "copy",
        ...safeErrorLogFields(cause),
      });
    }
  }

  return (
    <div className="flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">{label}</p>
        <p className="break-all font-medium leading-6">{value}</p>
      </div>
      {copy ? (
        <IconButton aria-label={`Copy ${label}`} className="size-9 p-1" disabled={!isCopyable} onClick={() => { void copyValue(); }} variant="ghost">
          <CopyIcon size={20} />
        </IconButton>
      ) : null}
    </div>
  );
}

function ManagementButton({ children, icon, onClick }: { children: string; icon: ReactNode; onClick?: () => void }) {
  return <Button className="w-full md:h-10 md:min-w-0 md:flex-1 md:px-4 md:py-2" onClick={onClick} size="lg" variant="secondary">{icon}{children}</Button>;
}

export { IdentityManagement };
