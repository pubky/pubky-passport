import Image from "next/image";

import type { GoogleAccountProfile } from "../../../../libs/googleAccountProfile";
import type { PubkyPublicIdentity } from "../../../logic/pubky/pubkyIdentityKey";
import { PassportScreen } from "../../shared/passportScreen";
import { Button } from "../../shared/primitives/button";
import { DisplayHeading, LeadText } from "../../shared/primitives/typography";
import { SignInContext } from "../../shared/signInContext";
import { GoogleAccountCard } from "./googleAccountCard";

function GoogleIdentityComplete({
  googleAccount,
  identity,
  mode,
  onContinue,
  signInTo,
  visibleRecoveryCopyStatus,
}: {
  googleAccount: GoogleAccountProfile;
  identity: PubkyPublicIdentity;
  mode: "created" | "restored";
  onContinue: () => void;
  signInTo?: string;
  visibleRecoveryCopyStatus: "created" | "unconfirmed" | null;
}) {
  const restored = mode === "restored";
  return (
    <PassportScreen className="gap-0 md:pb-0">
      <div className="flex flex-col gap-3">
        <DisplayHeading
          accent="complete."
          aria-label={restored ? "Restore complete." : "Setup complete."}
        >
          {restored ? "Restore" : "Setup"}
        </DisplayHeading>
        {signInTo ? <SignInContext requester={signInTo} /> : null}
        <LeadText>
          {restored ? "Restored backup from Google Drive." : "Stored backup in Google Drive."}
        </LeadText>
      </div>
      <div className="mt-8 flex flex-col">
        {visibleRecoveryCopyStatus === "unconfirmed" ? (
          <p
            className="mb-6 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm leading-5"
            role="status"
          >
            Your identity is ready, but Passport could not confirm the visible recovery copy in
            Google Drive. Download a recovery file from identity management.
          </p>
        ) : null}
        <GoogleAccountCard account={googleAccount} />
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
          className="mx-auto mt-6 size-[200px] md:order-4 md:mt-8"
          height={200}
          src="/illustrations/checkmark.png"
          width={200}
        />
        <Button className="mt-8 w-full md:order-3 md:mt-6" onClick={onContinue} size="lg">
          <ArrowRightIcon />
          Continue
        </Button>
      </div>
    </PassportScreen>
  );
}

function ArrowRightIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
      <path
        d="M3.33 8h9.34M8.67 4l4 4-4 4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

export { GoogleIdentityComplete };
