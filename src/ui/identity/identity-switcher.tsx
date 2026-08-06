"use client";

import Image from "next/image";

import type { LocalIdentitySummary } from "../../browser/identity/passportIdentity";
import { Button } from "../components/button";
import { DisplayHeading } from "../components/typography";
import { IdentityRow } from "./identity-row";
import { BackButton } from "./back-button";

function IdentitySwitcher({ activeIdentityId, identities, onAddIdentity, onBack, onSelect }: {
  activeIdentityId: string;
  identities: LocalIdentitySummary[];
  onAddIdentity: () => void;
  onBack: () => void;
  onSelect: (identityId: string) => void;
}) {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-84px)] w-full max-w-[375px] flex-col gap-8 px-6 pb-6 pt-3">
      <DisplayHeading accent="identity." aria-label="Switch identity.">Switch</DisplayHeading>
      <section className="flex flex-col gap-3">
        <p className="text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">Select a Pubky</p>
        {identities.map((identity) => {
          const account = identity.googleAccount;
          return (
            <IdentityRow
              {...(account?.pictureUrl ? { avatarSrc: account.pictureUrl } : {})}
              detail={shortPublicKey(identity.publicIdentity.publicKeyZ32)}
              key={identity.id}
              name={account?.name ?? "Your Pubky"}
              onClick={() => onSelect(identity.id)}
              {...(account ? { provider: "google" } : {})}
              selected={identity.id === activeIdentityId}
            />
          );
        })}
        <Button className="mt-0 w-full" onClick={onAddIdentity} size="lg" variant="secondary">
          <Image alt="" className="brightness-0 invert opacity-80" height={16} src="/icons/figma-user-round-plus.svg" width={16} />
          Add identity
        </Button>
      </section>
      <div className="mt-auto"><BackButton onClick={onBack} /></div>
    </main>
  );
}

function shortPublicKey(publicKey: string): string {
  return publicKey.length > 12 ? `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}` : publicKey;
}

export { IdentitySwitcher, shortPublicKey };
