import Image from "next/image";

import type { IdentityProviderAccount } from "@/client/logic/local-identity/localIdentityModels";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { ProviderAccountCard } from "@/client/ui/shared/providerAccountCard";
import { ArrowRightIcon } from "@/client/ui/shared/icons";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

/** Confirms a newly created identity; a restored identity moves on without this screen. */
function IdentityComplete({
  account,
  identity,
  notice,
  onContinue,
  storageName,
}: {
  account: IdentityProviderAccount;
  identity: PubkyPublicIdentity;
  /** Optional status shown above the account card, for example a missing recovery copy. */
  notice?: string | undefined;
  onContinue: () => void;
  /** Where the encrypted backup lives, for example "Google Drive". */
  storageName: string;
}) {
  return (
    <PassportScreen className="gap-0">
      <div className="flex flex-col gap-6">
        <DisplayHeading accent="complete." aria-label="Setup complete.">
          Setup
        </DisplayHeading>
        <LeadText>Stored backup in {storageName}.</LeadText>
      </div>
      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        {notice ? (
          <p
            className="mb-6 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm leading-5"
            role="status"
          >
            {notice}
          </p>
        ) : null}
        <ProviderAccountCard account={account} />
        <div className="mt-6 min-h-[84px] rounded-xl border border-brand/32 p-[15px] shadow-xl">
          <p className="mb-2 text-xs font-medium uppercase leading-5 tracking-[0.1em] text-brand">
            Your Pubky
          </p>
          <p className="break-all font-medium leading-6 text-secondary-foreground">
            {identity.publicKeyZ32}
          </p>
        </div>
        <Image
          alt=""
          aria-hidden="true"
          className="mx-auto mt-6 size-50"
          height={200}
          src="/illustrations/checkmark.png"
          width={200}
        />
        <Button className="mt-auto w-full" onClick={onContinue} size="lg">
          <ArrowRightIcon />
          Continue
        </Button>
      </div>
    </PassportScreen>
  );
}

export { IdentityComplete };
