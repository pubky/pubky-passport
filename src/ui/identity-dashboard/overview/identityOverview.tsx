"use client";

import Link from "next/link";

import type { LocalIdentitySummary } from "../../../browser/identity/passportIdentity";
import { GoogleLogo } from "../../shared/brand/googleLogo";
import { KeyRoundIcon, SettingsIcon, SquareUserRoundIcon } from "../../shared/icons/actionIcons";
import { PassportScreen } from "../../shared/layout/passportScreen";
import { Avatar } from "../../shared/primitives/avatar";
import { Button } from "../../shared/primitives/button";
import { DisplayHeading } from "../../shared/primitives/typography";

function IdentityOverview({ identity, onManage, onSwitch }: {
  identity: LocalIdentitySummary;
  onManage: () => void;
  onSwitch: () => void;
}) {
  const account = identity.googleAccount;
  const name = account?.name ?? "Your Pubky";

  return (
    <PassportScreen className="gap-8">
      <DisplayHeading accent="pubky." aria-label="Your pubky." className="[&>span]:inline">Your </DisplayHeading>
      <section className="flex w-full flex-col items-center gap-6 overflow-hidden rounded-2xl bg-card px-6 pb-6 pt-12">
        <Avatar fallback={name} size="lg" {...(account?.pictureUrl ? { src: account.pictureUrl } : {})} />
        <div className="flex w-full flex-col items-center gap-3 text-center">
          <h2 className="text-2xl font-bold leading-8">{name}</h2>
          <p className="w-full break-all text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">{identity.publicIdentity.publicKeyZ32}</p>
          {account ? <p className="flex items-center justify-center gap-2 text-sm font-bold leading-5"><GoogleLogo />{account.email}</p> : null}
        </div>
        <Button asChild className="w-full" size="lg" variant="secondary">
          <Link href="/authorize"><KeyRoundIcon />Authorize</Link>
        </Button>
        <div className="flex w-full gap-3">
          <Button className="min-w-0 flex-1" onClick={onManage} variant="secondary"><SettingsIcon />Manage</Button>
          <Button className="min-w-0 flex-1" onClick={onSwitch} variant="secondary"><SquareUserRoundIcon />Switch</Button>
        </div>
      </section>
    </PassportScreen>
  );
}

export { IdentityOverview };
