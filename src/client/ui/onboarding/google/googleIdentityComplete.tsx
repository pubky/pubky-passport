import { SetupProgressProvider } from "@/client/ui/shared/setupProgress";
import { Notice } from "@/client/ui/shared/notice";
import { PublicKeyCard } from "@/client/ui/shared/publicKeyCard";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import type { VisibleRecoveryCopyStatus } from "@/client/logic/google-identity/GoogleIdentityController";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { ArrowRightIcon } from "@/client/ui/shared/icons";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { GoogleAccountCard } from "./googleAccountCard";

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
    <SetupProgressProvider steps={["Google backup", "Profile"]} current={0}>
      <PassportScreen className="gap-0 md:pb-0">
        <div className="flex flex-col gap-6 md:gap-3">
          <DisplayHeading accent="ready." aria-label="Backup ready.">
            Backup
          </DisplayHeading>
          <LeadText>Stored backup in Google Drive.</LeadText>
        </div>
        <div className="mt-6 flex min-h-0 flex-1 flex-col md:mt-8">
          {visibleRecoveryCopyStatus === "unconfirmed" ||
          visibleRecoveryCopyStatus === "skipped" ? (
            <Notice className="mb-6" tone="warning">
              {visibleRecoveryCopyStatus === "skipped"
                ? "Your identity is ready. No visible recovery copy was created in Google Drive because you did not grant that permission. Download a recovery file from identity management."
                : "Your identity is ready, but Passport could not confirm the visible recovery copy in Google Drive. Download a recovery file from identity management."}
            </Notice>
          ) : null}
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
