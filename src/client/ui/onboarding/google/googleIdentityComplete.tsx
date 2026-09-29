import { GOOGLE_SETUP_STEPS, SetupProgressProvider } from "@/client/ui/shared/setupProgress";
import { PublicKeyCard } from "@/client/ui/shared/publicKeyCard";
import { SHORT_WINDOW_GAP, SHORT_WINDOW_HEADING } from "@/client/ui/shared/shortWindow";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import type { VisibleRecoveryCopyStatus } from "@/client/logic/google-identity/GoogleIdentityController";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { ArrowRightIcon } from "@/client/ui/shared/icons";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { GoogleAccountCard } from "./googleAccountCard";
import { VisibleCopyNotice } from "./visibleCopyNotice";

/**
 * Confirms a newly created identity; a restored identity moves on without this screen. The space
 * under the stepper matches the other setup steps. In a short window, such as an app's 760px
 * sign-in popup, the heading shrinks as the request heading does and the space between the parts
 * below tightens, so Continue stays above the fold even with the folder-copy note.
 */
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
        <div className={cn("flex min-h-0 flex-1 flex-col gap-6 md:gap-8", SHORT_WINDOW_GAP)}>
          <div className="flex flex-col gap-6 md:gap-3 [@media(max-height:50rem)]:gap-3">
            <DisplayHeading
              accent="ready."
              aria-label="Backup ready."
              className={SHORT_WINDOW_HEADING}
            >
              Backup
            </DisplayHeading>
            <LeadText>Stored backup in Google Drive.</LeadText>
          </div>
          <div className={cn("flex flex-col gap-6", SHORT_WINDOW_GAP)}>
            <VisibleCopyNotice status={visibleRecoveryCopyStatus} />
            <GoogleAccountCard account={googleAccount} />
            <PublicKeyCard publicKey={identity.publicKeyZ32} />
            <Button className="w-full" onClick={onContinue} size="lg">
              <ArrowRightIcon />
              Continue
            </Button>
          </div>
        </div>
      </PassportScreen>
    </SetupProgressProvider>
  );
}

export { GoogleIdentityComplete };
