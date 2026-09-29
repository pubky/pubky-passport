import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { invitesOnly } from "@/client/logic/homegate/verificationMethods";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { IdentityEstablishmentFlow } from "@/client/ui/onboarding/identityEstablishmentFlow";
import { ContinueWithGoogle } from "@/client/ui/onboarding/google/continueWithGoogle";
import { RequestHeading } from "@/client/ui/authorization/requestHeading";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { ProviderTerms, usePassportProvider } from "@/client/ui/passportProviderConfiguration";
import { BackButton } from "@/client/ui/shared/backButton";
import { CancelButton } from "@/client/ui/shared/cancelButton";
import { ChoiceCard } from "@/client/ui/shared/choiceCard";
import { FolderIcon, UserRoundPlusIcon } from "@/client/ui/shared/icons";
import { Button } from "@/client/ui/shared/primitives/button";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { useHomegateAvailability } from "@/client/ui/homegateAvailability";
import { GoogleSignupAvailability } from "@/client/ui/verificationAvailability";

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
            <ChoiceCard
              description={
                // Where an invite is the only way in, say so before the person starts.
                invitesOnly(methods)
                  ? "Create an account with an invite code and keep its key in Pubky Ring or this browser. Already have a backup file? Import it."
                  : "Create an account and keep its key in Pubky Ring or this browser. Already have a backup file? Import it."
              }
              illustration="/illustrations/identity-keys.png"
              title="Hold your own key"
            >
              <Button className="w-full" onClick={onCreateAccount} size="lg">
                <UserRoundPlusIcon /> Create account
              </Button>
              <Button className="w-full" onClick={onImport} size="lg" variant="secondary">
                <FolderIcon /> Import backup
              </Button>
            </ChoiceCard>
            {showGoogle ? (
              <ChoiceCard
                description={`${googleSignupBlocked ? "Restore an account you created with Google." : "Create or restore an account with Google."} Your key is encrypted before it’s saved to your Google Drive, and Google never sees it.`}
                illustration="/illustrations/cloud.png"
                title="Google account"
              >
                {/* The check and its retry concern only new Google sign-ups, so they stay here. */}
                <GoogleSignupAvailability availability={methods.google} onRetry={retry} />
                <ContinueWithGoogle
                  label={googleSignupBlocked ? "Restore with Google" : "Continue with Google"}
                  onContinue={startGoogle}
                />
              </ChoiceCard>
            ) : null}
          </div>
          {ring ? (
            // Quiet on purpose: Ring suits people who already have it, not newcomers.
            <p className="flex flex-wrap items-center justify-center gap-x-1 text-center text-sm leading-5 text-muted-foreground">
              Already use Pubky Ring?
              <Button onClick={ring.action} variant="link">
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
