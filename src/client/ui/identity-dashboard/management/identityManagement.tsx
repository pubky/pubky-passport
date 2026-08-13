"use client";

import { Result } from "better-result";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import type { LocalIdentityMetadata, PubkyHomeserverResolutionResult } from "../../../logic/identity/passportIdentityController";
import { CopyIcon, DownloadIcon, KeyRoundIcon, LinkOffIcon } from "../../shared/icons/actionIcons";
import { PassportScreen } from "../../shared/layout/passportScreen";
import { BackButton } from "../../shared/navigation/backButton";
import { Avatar } from "../../shared/primitives/avatar";
import { Button } from "../../shared/primitives/button";
import { IconButton } from "../../shared/primitives/iconButton";
import { DisplayHeading } from "../../shared/primitives/typography";

function IdentityManagement({ identity, onBack, onDetachFromGoogle, onDownloadBackup, onLogOut, onMigrateToKeychain, resolveHomeserver }: { identity: LocalIdentityMetadata; onBack: () => void; onDetachFromGoogle: () => void; onDownloadBackup: () => void; onLogOut: () => void; onMigrateToKeychain: () => void; resolveHomeserver: (publicKeyZ32: string) => Promise<PubkyHomeserverResolutionResult> }) {
  const account = identity.googleAccount;
  const name = account?.name ?? "Your Pubky";
  const [homeserver, setHomeserver] = useState<string | null | undefined>();

  useEffect(() => {
    let cancelled = false;
    resolveHomeserver(identity.publicIdentity.publicKeyZ32).then((result) => {
      if (!cancelled) setHomeserver(Result.isError(result) ? null : result.value);
    });
    return () => { cancelled = true; };
  }, [identity.publicIdentity.publicKeyZ32, resolveHomeserver]);

  return (
    <PassportScreen className="gap-6">
      <Button className="absolute right-6 top-[22px] z-10" onClick={onLogOut} variant="secondary">Log out</Button>
      <header className="flex items-start gap-6">
        <DisplayHeading accent="identity." aria-label="Manage identity.">Manage</DisplayHeading>
        <Avatar className="ml-auto" fallback={name} size="lg" {...(account?.pictureUrl ? { src: account.pictureUrl } : {})} />
      </header>

      <section className="flex flex-col gap-6">
        <IdentityDetail label="User" value={name} />
        <IdentityDetail label="Google account" value={account?.email ?? "Not connected"} />
        <IdentityDetail copy label="Pubky" value={identity.publicIdentity.publicKeyZ32} />
        <IdentityDetail copy label="Homeserver" value={homeserver === undefined ? "Looking up…" : homeserver ?? "Unavailable"} />
      </section>

      <div className="mt-auto flex flex-col gap-4 pt-6">
        <ManagementButton icon={<KeyRoundIcon />} onClick={onMigrateToKeychain}>Migrate to keychain</ManagementButton>
        <ManagementButton icon={<DownloadIcon />} onClick={onDownloadBackup}>Download backup</ManagementButton>
        <ManagementButton icon={<LinkOffIcon />} onClick={onDetachFromGoogle}>Detach from Google</ManagementButton>
        <BackButton onClick={onBack} />
      </div>
    </PassportScreen>
  );
}

function IdentityDetail({ copy = false, label, value }: { copy?: boolean; label: string; value: string }) {
  const isCopyable = copy && value !== "Unavailable" && value !== "Looking up…";

  function copyValue() {
    void navigator.clipboard.writeText(value).catch(() => undefined);
  }

  return (
    <div className="flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">{label}</p>
        <p className="break-all font-medium leading-6">{value}</p>
      </div>
      {copy ? (
        <IconButton aria-label={`Copy ${label}`} className="size-9 p-1" disabled={!isCopyable} onClick={copyValue} variant="ghost">
          <CopyIcon size={20} />
        </IconButton>
      ) : null}
    </div>
  );
}

function ManagementButton({ children, icon, onClick }: { children: string; icon: ReactNode; onClick?: () => void }) {
  return <Button className="w-full" onClick={onClick} size="lg" variant="secondary">{icon}{children}</Button>;
}

export { IdentityManagement };
