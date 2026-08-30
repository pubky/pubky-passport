import Image from "next/image";

import type { GoogleAccountProfile } from "../../../../libs/googleAccountProfile";
import type { PubkyPublicIdentity } from "../../../logic/pubky/pubkyIdentityKey";
import { PassportNavigation } from "../../shared/passportNavigation";
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
    <PassportScreen className="gap-8">
      <div className="flex flex-col gap-6">
        <DisplayHeading
          accent="complete."
          aria-label={restored ? "Restore complete." : "Setup complete."}
        >
          {restored ? "Restore" : "Setup"}
        </DisplayHeading>
        {signInTo ? <SignInContext requester={signInTo} /> : null}
        <LeadText>
          {restored
            ? "Restored Passport file from Google Drive."
            : "Stored Passport file in Google Drive."}
        </LeadText>
        {visibleRecoveryCopyStatus === "unconfirmed" ? (
          <p
            className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm leading-5"
            role="status"
          >
            Your identity is ready, but Passport could not confirm the visible recovery copy in
            Google Drive. Download a recovery file from identity management.
          </p>
        ) : null}
        <GoogleAccountCard account={googleAccount} />
        <div className="rounded-xl border border-brand/30 p-4 shadow-xl">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-brand">
            Your Pubky
          </p>
          <p className="break-all font-medium leading-6 text-secondary-foreground">
            {identity.publicKeyZ32}
          </p>
        </div>
        <Image
          alt=""
          aria-hidden="true"
          className="mx-auto size-[200px]"
          height={200}
          src="/illustrations/checkmark.png"
          width={200}
        />
      </div>
      <PassportNavigation
        confirm={
          <Button className="w-full" onClick={onContinue} size="lg">
            <ArrowRightIcon />
            Continue
          </Button>
        }
      />
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
