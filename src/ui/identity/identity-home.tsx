"use client";

import Image from "next/image";
import Link from "next/link";

import type { LocalIdentitySummary } from "../../browser/identity/passportIdentity";
import { Avatar } from "../components/avatar";
import { Button } from "../components/button";
import { GoogleLogo } from "../components/google-logo";
import { DisplayHeading } from "../components/typography";

function IdentityHome({ identity, onManage, onSwitch }: {
  identity: LocalIdentitySummary;
  onManage?: () => void;
  onSwitch: () => void;
}) {
  const account = identity.googleAccount;
  const name = account?.name ?? "Your Pubky";

  return (
    <main className="mx-auto flex min-h-[calc(100svh-84px)] w-full max-w-[375px] flex-col gap-8 px-6 pb-6 pt-3">
      <DisplayHeading accent="pubky." aria-label="Your pubky." className="[&>span]:inline">Your </DisplayHeading>
      <section className="flex w-full flex-col items-center gap-6 overflow-hidden rounded-2xl bg-card px-6 pb-6 pt-12">
        <Avatar fallback={name} size="lg" {...(account?.pictureUrl ? { src: account.pictureUrl } : {})} />
        <div className="flex w-full flex-col items-center gap-3 text-center">
          <h2 className="text-2xl font-bold leading-8">{name}</h2>
          <p className="w-full break-all text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">{identity.publicIdentity.publicKeyZ32}</p>
          {account ? <p className="flex items-center justify-center gap-2 text-sm font-bold leading-5"><GoogleLogo />{account.email}</p> : null}
        </div>
        <Button asChild className="w-full" size="lg" variant="secondary">
          <Link href="/authorize"><ActionIcon alt="" src="/icons/figma-key-round.svg" />Authorize</Link>
        </Button>
        <div className="flex w-full gap-3">
          <Button className="min-w-0 flex-1" onClick={onManage} variant="secondary"><ActionIcon alt="" src="/icons/figma-settings.svg" />Manage</Button>
          <Button className="min-w-0 flex-1" onClick={onSwitch} variant="secondary"><ActionIcon alt="" src="/icons/figma-square-user-round.svg" />Switch</Button>
        </div>
      </section>
    </main>
  );
}

function ActionIcon({ alt, src }: { alt: string; src: string }) {
  return <Image alt={alt} className="brightness-0 invert opacity-80" height={16} src={src} width={16} />;
}

export { IdentityHome };
