import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { invitesOnly } from "@/client/logic/homegate/verificationMethods";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { IdentityEstablishmentFlow } from "@/client/ui/onboarding/identityEstablishmentFlow";
import { ContinueWithGoogle } from "@/client/ui/onboarding/google/continueWithGoogle";
import { BroadAccessWarning } from "@/client/ui/authorization/broadAccessWarning";
import { RequestHeading } from "@/client/ui/authorization/requestHeading";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { SHORT_WINDOW_GAP } from "@/client/ui/shared/shortWindow";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { ProviderTerms, usePassportProvider } from "@/client/ui/passportProviderConfiguration";
import { BackButton } from "@/client/ui/shared/backButton";
import { ChoiceCard } from "@/client/ui/shared/choiceCard";
import { FolderIcon, UserRoundPlusIcon, XIcon } from "@/client/ui/shared/icons";
import { OrDivider } from "@/client/ui/shared/orDivider";
import { PassportHeaderAction } from "@/client/ui/shared/passportHeaderAction";
import { Button } from "@/client/ui/shared/primitives/button";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { useHomegateAvailability } from "@/client/ui/homegateAvailability";
import { GoogleSignupAvailability } from "@/client/ui/verificationAvailability";

/**
 * The start page: create an account, import a recovery file, Google, and Pubky Ring. During an
 * app's request it is the request's first step when nothing is saved, and Use another identity
 * opens it from the identity list; there Pubky Ring is a full button below an "or", because it
 * answers the waiting app directly. Without a request, Ring is a quiet link for people who
 * already use it.
 */
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
  /** Answers the waiting app from the header, when this page is the request's first step. */
  onCancel?: (() => void) | undefined;
  onComplete: (identity: LocalIdentityMetadata) => void;
  onImport: () => void;
  onCreateAccount: () => void;
  /** Hands a pending app request to Ring unchanged. */
  onUseRing?: (() => void) | undefined;
  /** Adds an existing Ring identity through Passport's own connection; offered without a request. */
  onConnectRing?: (() => void) | undefined;
}) {
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
        <PassportScreen
          width={showGoogle ? "wide" : "compact"}
          className={cn("gap-6", forAuthorization && SHORT_WINDOW_GAP)}
        >
          {onCancel ? (
            <PassportHeaderAction>
              <Button onClick={onCancel} variant="secondary">
                <XIcon /> Cancel
              </Button>
            </PassportHeaderAction>
          ) : null}
          {request ? (
            // Compact like the identity list, and without a lead sentence, so the request's first
            // step stays as short as it can in the app's 760px popup.
            <RequestHeading compact review={request} />
          ) : (
            <div className="space-y-3">
              <AddIdentityHeading adding={Boolean(onBack)} />
              <LeadText>Create an account or add one you already have.</LeadText>
            </div>
          )}
          {/* Continue with Pubky Ring below hands the request on without its review. */}
          {request ? <BroadAccessWarning capabilities={request.capabilities} /> : null}
          <div
            className={cn(
              "grid gap-6",
              showGoogle && "lg:grid-cols-2",
              forAuthorization && SHORT_WINDOW_GAP,
            )}
          >
            {/* The recommended path comes first in the DOM, so reading and tab order match. */}
            <ChoiceCard
              description={
                // Where an invite is the only way in, say so before the person starts.
                invitesOnly(methods)
                  ? "Create an account with an invite code and keep its key in Pubky Ring or this browser. Already have a recovery file? Import it."
                  : "Create an account and keep its key in Pubky Ring or this browser. Already have a recovery file? Import it."
              }
              illustration="/illustrations/identity-keys.png"
              title="Hold your own key"
            >
              <Button className="w-full" onClick={onCreateAccount} size="lg">
                <UserRoundPlusIcon /> Create account
              </Button>
              <Button className="w-full" onClick={onImport} size="lg" variant="secondary">
                <FolderIcon /> Import recovery file
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
          {onUseRing ? (
            // Only for an app's request: Ring answers the waiting app itself, named as on the
            // identity list and the review.
            <div className="flex flex-col gap-4 [@media(max-height:50rem)]:gap-3">
              <OrDivider />
              <Button
                className="w-full self-center md:max-w-sm"
                onClick={onUseRing}
                size="lg"
                variant="secondary"
              >
                <PubkyBrandIcon /> Continue with Pubky Ring
              </Button>
            </div>
          ) : onConnectRing ? (
            // Quiet on purpose: Ring suits people who already have it, not newcomers. Connecting
            // a Ring identity signs the person in to Passport with it.
            <p className="flex flex-wrap items-center justify-center gap-x-1 text-center text-sm leading-5 text-muted-foreground">
              Already use Pubky Ring?
              <Button onClick={onConnectRing} variant="link">
                <PubkyBrandIcon /> Sign in with Pubky Ring
              </Button>
            </p>
          ) : null}
          <ProviderTerms />
          {onBack ? <BackButton className="mt-3" onClick={onBack} /> : null}
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
