import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { useHomegateAvailability } from "@/client/ui/homegateAvailability";
import { ContinueWithGoogle } from "@/client/ui/onboarding/google/continueWithGoogle";
import { IdentityEstablishmentFlow } from "@/client/ui/onboarding/identityEstablishmentFlow";
import { ProviderTerms } from "@/client/ui/passportProviderConfiguration";
import { BackButton } from "@/client/ui/shared/backButton";
import { FolderIcon } from "@/client/ui/shared/icons";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { GoogleSignupAvailability } from "@/client/ui/verificationAvailability";
import { RequestHeading } from "../requestHeading";

/**
 * The quieter ways into a request, one step from its identity list: a Google account (to create
 * or restore an identity) and an encrypted backup. The list itself offers Create account and
 * Pubky Ring, so they are not repeated here. Offered only on an instance with Google; without it
 * the list's link opens the backup import directly.
 */
export function OtherWaysIn({
  onBack,
  onComplete,
  onImport,
  review,
}: {
  onBack: () => void;
  onComplete: (identity: LocalIdentityMetadata) => void;
  onImport: () => void;
  review: AuthorizationRequestReview;
}) {
  const { methods, retry } = useHomegateAvailability();
  return (
    <IdentityEstablishmentFlow
      forAuthorization
      onComplete={onComplete}
      renderEntry={(startGoogle) => (
        <PassportScreen className="gap-6">
          <div className="flex flex-col gap-3">
            <RequestHeading compact review={review} />
            <p className="text-base leading-6 text-muted-foreground">
              Continue with your Google account, or import a recovery file of your key.
            </p>
          </div>
          <section
            aria-label="Other ways to sign in"
            className="flex min-w-0 flex-col gap-3 rounded-lg bg-card p-6"
          >
            <GoogleSignupAvailability availability={methods.google} onRetry={retry} />
            <ContinueWithGoogle
              label={
                methods.google.status === "blocked" ? "Restore with Google" : "Continue with Google"
              }
              onContinue={startGoogle}
            />
            <Button className="w-full" onClick={onImport} size="lg" variant="secondary">
              <FolderIcon /> Import recovery file
            </Button>
          </section>
          <ProviderTerms />
          <BackButton className="mt-auto md:mt-0" onClick={onBack} />
        </PassportScreen>
      )}
    />
  );
}
