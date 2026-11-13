import Image from "next/image";

import type { LocalIdentityImport } from "@/client/logic/local-identity/LocalIdentityController";
import { ArrowRightIcon } from "@/client/ui/shared/icons";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

/** Shows which pubky was imported before the person moves on. */
function ImportComplete({
  imported,
  onContinue,
}: {
  imported: LocalIdentityImport;
  onContinue: () => void;
}) {
  return (
    <PassportScreen className="gap-6">
      <div className="flex flex-col gap-6">
        <DisplayHeading accent="imported." aria-label="Pubky imported.">
          Pubky
        </DisplayHeading>
        <LeadText>
          {imported.alreadyStored
            ? "This pubky was already in this browser. Passport switched to it."
            : "Signed in to your homeserver. This pubky is stored only in this browser."}
        </LeadText>
      </div>
      <div className="min-h-[84px] rounded-xl border border-brand/32 p-[15px] shadow-xl">
        <p className="mb-2 text-xs font-medium uppercase leading-5 tracking-[0.1em] text-brand">
          Your Pubky
        </p>
        <p className="break-all font-medium leading-6 text-secondary-foreground">
          {imported.publicIdentity.publicKeyZ32}
        </p>
      </div>
      {imported.alreadyStored ? null : (
        <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm leading-5">
          Your pubky is self-managed and recoverable only with your backup. Keep your recovery
          phrase or file safe.
        </p>
      )}
      <Image
        alt=""
        aria-hidden="true"
        className="mx-auto size-50"
        height={200}
        src="/illustrations/checkmark.png"
        width={200}
      />
      <PassportNavigation
        className="mt-auto"
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

export { ImportComplete };
