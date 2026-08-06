"use client";

import Image from "next/image";

import type { LocalIdentitySummary } from "../../browser/identity/passportIdentity";
import { Avatar } from "../components/avatar";
import { Button } from "../components/button";
import { DisplayHeading } from "../components/typography";

function IdentityManagement({ identity, onLogOut }: { identity: LocalIdentitySummary; onLogOut: () => void }) {
  const account = identity.googleAccount;
  const name = account?.name ?? "Your Pubky";

  return (
    <main className="mx-auto flex min-h-[calc(100svh-84px)] w-full max-w-[375px] flex-col gap-6 px-6 pb-6 pt-3">
      <Button className="absolute right-6 top-[22px] z-10" onClick={onLogOut} variant="secondary">Log out</Button>
      <header className="flex items-start gap-6">
        <DisplayHeading accent="identity." aria-label="Manage identity.">Manage</DisplayHeading>
        <Avatar className="ml-auto" fallback={name} size="lg" {...(account?.pictureUrl ? { src: account.pictureUrl } : {})} />
      </header>

      <section className="flex flex-col gap-6">
        <IdentityDetail label="User" value={name} />
        <IdentityDetail label="Google account" value={account?.email ?? "Not connected"} />
        <IdentityDetail label="Pubky" value={identity.publicIdentity.publicKeyZ32} />
        <IdentityDetail label="Homeserver" value="Unavailable" />
      </section>

      <div className="mt-auto flex flex-col gap-4 pt-6">
        <ManagementButton icon="/icons/figma-key-round.svg">Migrate to keychain</ManagementButton>
        <ManagementButton icon="/icons/figma-download.svg">Download backup</ManagementButton>
        <ManagementButton icon="/icons/figma-link-off.svg">Detach from Google</ManagementButton>
      </div>
    </main>
  );
}

function IdentityDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="break-all font-medium leading-6">{value}</p>
    </div>
  );
}

function ManagementButton({ children, icon }: { children: string; icon: string }) {
  return <Button className="w-full" size="lg" variant="secondary"><ActionIcon src={icon} />{children}</Button>;
}

function ActionIcon({ src }: { src: string }) {
  return <Image alt="" className="brightness-0 invert opacity-80" height={16} src={src} width={16} />;
}

export { IdentityManagement };
