import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { IdentityEstablishmentFlow } from "@/client/ui/onboarding/identityEstablishmentFlow";
import { ContinueWithGoogle } from "@/client/ui/onboarding/google/continueWithGoogle";
import Image from "next/image";
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

export function AddIdentity({
  forAuthorization = false,
  onBack,
  onCancel,
  onComplete,
  onImport,
  onCreateAccount,
  onUseRing,
  onConnectRing,
}: {
  /** Whether a supplied request waits behind this screen; set by the shell, not inferred. */
  forAuthorization?: boolean | undefined;
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
  const ring = onUseRing
    ? { label: "Use Pubky Ring", action: onUseRing }
    : onConnectRing
      ? { label: "Connect Pubky Ring", action: onConnectRing }
      : undefined;
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
        <PassportScreen width="wide" className="gap-6">
          <div className="space-y-3">
            <DisplayHeading
              accent="signing."
              aria-label="Quick & easy signing."
              className="[&>span]:inline"
            >
              Quick & easy{" "}
            </DisplayHeading>
            <LeadText>Add an existing identity or create your Pubky account.</LeadText>
          </div>
          <div className={`grid gap-6 ${showGoogle ? "lg:grid-cols-2" : ""}`}>
            <section
              aria-labelledby="add-existing-heading"
              className="flex min-w-0 flex-col gap-6 rounded-lg bg-card p-6 lg:p-8 xl:flex-row xl:items-start xl:gap-12 xl:p-12"
            >
              <Image
                alt=""
                aria-hidden="true"
                src="/illustrations/identity-keys.png"
                width={192}
                height={192}
                className="hidden size-48 shrink-0 object-contain lg:block xl:self-center"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <h2 id="add-existing-heading" className="text-2xl font-bold leading-8">
                  Your keys
                </h2>
                <p className="mb-3 text-sm leading-5 text-muted-foreground">
                  {onUseRing
                    ? "Create an account, use Pubky Ring, or import an encrypted backup."
                    : onConnectRing
                      ? "Create an account, connect Pubky Ring, or import an encrypted backup."
                      : "Create an account or import an encrypted backup."}
                </p>
                {ring ? (
                  <Button className="w-full" onClick={ring.action} size="lg" variant="secondary">
                    <PubkyBrandIcon /> {ring.label}
                  </Button>
                ) : null}
                <Button className="w-full" onClick={onCreateAccount} size="lg" variant="secondary">
                  <UserRoundPlusIcon /> Create account
                </Button>
                <Button className="w-full" onClick={onImport} size="lg" variant="secondary">
                  <FolderIcon /> Import backup
                </Button>
              </div>
            </section>
            {showGoogle ? (
              <section
                aria-labelledby="add-quick-heading"
                className="flex min-w-0 flex-col gap-6 rounded-lg bg-card p-6 lg:p-8 xl:flex-row xl:items-start xl:gap-12 xl:p-12"
              >
                <Image
                  alt=""
                  aria-hidden="true"
                  src="/illustrations/cloud.png"
                  width={192}
                  height={192}
                  className="hidden size-48 shrink-0 object-contain lg:block xl:self-center"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <h2 id="add-quick-heading" className="text-2xl font-bold leading-8">
                    Quick & easy
                  </h2>
                  <p className="mb-3 text-sm leading-5 text-muted-foreground">
                    Use your Google account to create or restore your identity.
                  </p>
                  {googleSignupBlocked ? (
                    <p className="text-sm font-medium leading-5 text-foreground" role="status">
                      New Google identities are not available in your country. You can still restore
                      an existing one.
                    </p>
                  ) : null}
                  <ContinueWithGoogle onContinue={startGoogle} />
                </div>
              </section>
            ) : null}
          </div>
          <AvailabilityNotice methods={[methods.google]} onRetry={retry} />
          <ProviderTerms />
          {onBack ? <BackButton className="mt-3" onClick={onBack} /> : null}
          {onCancel ? <CancelButton className="mt-3" onClick={onCancel} /> : null}
        </PassportScreen>
      )}
    />
  );
}
