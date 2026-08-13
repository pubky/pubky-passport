"use client";

import type { LocalIdentityMetadata } from "../../../browser/identity/passportIdentityController";
import { UserRoundPlusIcon } from "../../shared/icons/actionIcons";
import { PassportScreen } from "../../shared/layout/passportScreen";
import { BackButton } from "../../shared/navigation/backButton";
import { Button } from "../../shared/primitives/button";
import { DisplayHeading } from "../../shared/primitives/typography";
import { IdentityRow } from "./identityRow";

function IdentitySwitcher({ activeIdentityId, identities, onAddIdentity, onBack, onSelect }: {
  activeIdentityId: string | null;
  identities: LocalIdentityMetadata[];
  onAddIdentity: () => void;
  onBack: () => void;
  onSelect: (identityId: string) => void;
}) {
  return (
    <PassportScreen className="gap-8">
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
          <UserRoundPlusIcon />
          Add identity
        </Button>
      </section>
      <div className="mt-auto"><BackButton onClick={onBack} /></div>
    </PassportScreen>
  );
}

function shortPublicKey(publicKey: string): string {
  return publicKey.length > 12 ? `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}` : publicKey;
}

export { IdentitySwitcher, shortPublicKey };
