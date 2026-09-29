import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { IdentityEstablishmentFlow } from "@/client/ui/onboarding/identityEstablishmentFlow";
import { ContinueWithGoogle } from "@/client/ui/onboarding/google/continueWithGoogle";
import Image from "next/image";
import { RequestHeading } from "@/client/ui/authorization/requestHeading";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { ProviderTerms, usePassportProvider } from "@/client/ui/passportProviderConfiguration";
import { BackButton } from "@/client/ui/shared/backButton";
import { CancelButton } from "@/client/ui/shared/cancelButton";
import { FolderIcon, UserRoundPlusIcon } from "@/client/ui/shared/icons";
import { Button } from "@/client/ui/shared/primitives/button";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { useHomegateAvailability } from "@/client/ui/homegateAvailability";
import { AvailabilityNotice } from "@/client/ui/verificationAvailability";

const CARD_CLASS_NAME =
  "flex min-w-0 flex-col gap-6 rounded-lg bg-card p-6 lg:p-8 xl:flex-row xl:items-start xl:gap-12 xl:p-12";

export function AddIdentity({
  request,
  onBack,
  onCancel,
  onComplete,
  onImport,
  onCreateAccount,
  onUseRing,
  onConnectRing,
}: {
  /**
   * The request waiting behind this screen, set by the shell rather than inferred. The heading
   * names its requester with what backs that name, and the flows below keep the request layout.
   */
  request?: AuthorizationRequestReview | undefined;
  onBack?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  onComplete: (identity: LocalIdentityMetadata) => void;
  onImport: () => void;
  onCreateAccount: () => void;
  /** Hands a pending app request to Ring unchanged. */
  onUseRing?: (() => void) | undefined;
  /** Adds an existing Ring identity through Passport's own connection; offered without a request. */
  onConnectRing?: (() => void) | undefined;
}) {
  // Handing a request over is named as on the review. Without one, connecting a Ring identity
  // signs the person in to Passport with it.
  const ring = onUseRing
    ? { label: "Open in Pubky Ring", action: onUseRing }
    : onConnectRing
      ? { label: "Sign in with Pubky Ring", action: onConnectRing }
      : undefined;
  const forAuthorization = request !== undefined;
  const provider = usePassportProvider();
  const { methods, retry } = useHomegateAvailability();
  // Restoring needs only Google Drive and Passport. The Homegate probe covers new identities only.
  const showGoogle = provider.features.google;
  const googleSignupBlocked = methods.google.status === "blocked";
  return (
    <IdentityEstablishmentFlow
      forAuthorization={forAuthorization}
      onComplete={onComplete}
      renderEntry={(startGoogle) => (
        <PassportScreen width={showGoogle ? "wide" : "compact"} className="gap-6">
          <div className="space-y-3">
            {request ? (
              <RequestHeading review={request} />
            ) : (
              <AddIdentityHeading adding={Boolean(onBack)} />
            )}
            <LeadText>
              {forAuthorization
                ? "To continue, create an account or add one you already have."
                : "Create an account or add one you already have."}
            </LeadText>
          </div>
          <div className={`grid gap-6 ${showGoogle ? "lg:grid-cols-2" : ""}`}>
            {/* The recommended path comes first in the DOM, so reading and tab order match. */}
            <section aria-labelledby="add-account-heading" className={CARD_CLASS_NAME}>
              <Image
                alt=""
                aria-hidden="true"
                src="/illustrations/identity-keys.png"
                width={192}
                height={192}
                className="hidden size-48 shrink-0 object-contain lg:block xl:self-center"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <h2 id="add-account-heading" className="text-2xl font-bold leading-8">
                  Hold your own key
                </h2>
                <p className="mb-3 text-sm leading-5 text-muted-foreground">
                  Create an account and keep its key in Pubky Ring or this browser. Already have a
                  backup file? Import it.
                </p>
                <Button className="w-full" onClick={onCreateAccount} size="lg">
                  <UserRoundPlusIcon /> Create account
                </Button>
                <Button className="w-full" onClick={onImport} size="lg" variant="secondary">
                  <FolderIcon /> Import backup
                </Button>
              </div>
            </section>
            {showGoogle ? (
              <section aria-labelledby="add-google-heading" className={CARD_CLASS_NAME}>
                <Image
                  alt=""
                  aria-hidden="true"
                  src="/illustrations/cloud.png"
                  width={192}
                  height={192}
                  className="hidden size-48 shrink-0 object-contain lg:block xl:self-center"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <h2 id="add-google-heading" className="text-2xl font-bold leading-8">
                    Google account
                  </h2>
                  <p className="mb-3 text-sm leading-5 text-muted-foreground">
                    Create or restore an account with Google. Your key is encrypted before it’s
                    saved to your Google Drive, and Google never sees it.
                  </p>
                  {googleSignupBlocked ? (
                    <p className="text-sm font-medium leading-5 text-foreground" role="status">
                      Creating an account with Google isn’t available in your country. You can still
                      restore an existing one.
                    </p>
                  ) : null}
                  <ContinueWithGoogle onContinue={startGoogle} />
                </div>
              </section>
            ) : null}
          </div>
          {/* The Google check's retry stays with the cards it belongs to, above the Ring line. */}
          <AvailabilityNotice methods={[methods.google]} onRetry={retry} />
          {ring ? (
            // Quiet on purpose: Ring suits people who already have it, not newcomers.
            <p className="flex flex-wrap items-center justify-center gap-x-1 text-center text-sm leading-5 text-muted-foreground">
              Already use Pubky Ring?
              <Button className="px-3" onClick={ring.action} variant="ghost">
                <PubkyBrandIcon /> {ring.label}
              </Button>
            </p>
          ) : null}
          <ProviderTerms />
          {onBack ? <BackButton className="mt-3" onClick={onBack} /> : null}
          {onCancel ? <CancelButton className="mt-3" onClick={onCancel} /> : null}
        </PassportScreen>
      )}
    />
  );
}

/** Without a request the heading names the task: a first account, or one more from the switcher. */
function AddIdentityHeading({ adding }: { adding: boolean }) {
  const [lead, accent] = adding ? ["Add an", "account."] : ["Get your", "pubky."];
  return (
    <DisplayHeading accent={accent} aria-label={`${lead} ${accent}`} className="[&>span]:inline">
      {lead}{" "}
    </DisplayHeading>
  );
}
