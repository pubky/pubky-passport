import Image from "next/image";

import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";
import type { GoogleAccountProfile } from "../../../core/identity/googleAccountProfile";
import { Button } from "../../shared/primitives/button";
import { DisplayHeading, LeadText } from "../../shared/primitives/typography";
import { GoogleAccountCard } from "../google-account-card";

function SetupComplete({ googleAccount, identity, mode, onContinue }: { googleAccount?: GoogleAccountProfile; identity: PubkyPublicIdentity; mode: "created" | "restored"; onContinue: () => void }) {
  const restored = mode === "restored";
  return (
    <main className="mx-auto flex min-h-[calc(100svh-84px)] w-full max-w-[375px] flex-col gap-8 px-6 pb-6 pt-3">
      <div className="flex flex-col gap-6">
        <DisplayHeading accent="complete." aria-label={restored ? "Restore complete." : "Setup complete."}>{restored ? "Restore" : "Setup"}</DisplayHeading>
        <LeadText>{restored ? "Restored backup from Google Drive." : "Stored backup in Google Drive."}</LeadText>
        {googleAccount ? <GoogleAccountCard account={googleAccount} /> : null}
        <div className="rounded-xl border border-brand/30 p-4 shadow-xl">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-brand">Your Pubky</p>
          <p className="break-all font-medium leading-6 text-secondary-foreground">{identity.publicKeyZ32}</p>
        </div>
        <Image alt="" aria-hidden="true" className="mx-auto size-[200px]" height={200} src="/illustrations/passport-setup-complete.png" width={200} />
      </div>
      <Button className="mt-auto w-full" onClick={onContinue} size="lg"><ArrowRightIcon />Continue</Button>
    </main>
  );
}

function ArrowRightIcon() {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 16 16"><path d="M3.33 8h9.34M8.67 4l4 4-4 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.3" /></svg>;
}

export { SetupComplete };
