import { GOOGLE_SETUP_STEPS, SetupProgressProvider } from "@/client/ui/shared/setupProgress";
import { PublicKeyCard } from "@/client/ui/shared/publicKeyCard";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import type { VisibleRecoveryCopyStatus } from "@/client/logic/google-identity/GoogleIdentityController";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { ArrowRightIcon } from "@/client/ui/shared/icons";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { GoogleAccountCard } from "./googleAccountCard";
import { VisibleCopyNotice } from "./visibleCopyNotice";

/** Confirms a newly created identity; a restored identity moves on without this screen. */
function GoogleIdentityComplete({
  googleAccount,
  identity,
  onContinue,
  visibleRecoveryCopyStatus,
}: {
  googleAccount: GoogleAccountProfile;
  identity: PubkyPublicIdentity;
  onContinue: () => void;
  visibleRecoveryCopyStatus: VisibleRecoveryCopyStatus;
}) {
  return (
    <SetupProgressProvider steps={GOOGLE_SETUP_STEPS} current={0}>
      <PassportScreen className="gap-6 md:gap-8 md:pb-0">
        <div className="flex flex-col gap-6 md:gap-3">
          <DisplayHeading accent="ready." aria-label="Backup ready.">
            Backup
          </DisplayHeading>
          <LeadText>Stored backup in Google Drive.</LeadText>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <VisibleCopyNotice
            className="mb-6"
            operation="create"
            status={visibleRecoveryCopyStatus}
          />
          <GoogleAccountCard account={googleAccount} />
          <div className="mt-6">
            <PublicKeyCard publicKey={identity.publicKeyZ32} />
          </div>
          <Button className="mt-6 w-full" onClick={onContinue} size="lg">
            <ArrowRightIcon />
            Continue
          </Button>
        </div>
      </PassportScreen>
    </SetupProgressProvider>
  );
}

export { GoogleIdentityComplete };
