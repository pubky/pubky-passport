import type { LocalIdentityRecoveryFileResult } from "@/client/logic/local-identity/LocalIdentityController";
import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type {
  IdentityProviderAccount,
  LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";
import type { PubkyRingMigration } from "@/client/logic/pubky/PubkySdkAdapter";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { DetachFromAppleFlow } from "@/client/ui/identity-dashboard/management/detach-from-apple/detachFromAppleFlow";
import { DetachFromGoogleFlow } from "@/client/ui/identity-dashboard/management/detach-from-google/detachFromGoogleFlow";
import { useAppleIdentity } from "@/client/ui/useAppleIdentity";

/** Routes "Detach from …" to the flow for the identity's sign-in provider. */
function DetachFromProviderFlow({
  account,
  ...props
}: {
  account: IdentityProviderAccount;
  createRecoveryFile: (
    publicKeyZ32: string,
    password: string,
  ) => Promise<LocalIdentityRecoveryFileResult>;
  createMigration: () => Promise<LocalIdentityResult<PubkyRingMigration>>;
  identity: LocalIdentityMetadata;
  onBack: () => void;
  onDone: () => void;
}) {
  switch (account.provider) {
    case "google":
      return (
        <DetachFromGoogleFlow googleSubject={account.googleAccount.googleSubject} {...props} />
      );
    case "apple":
      return <AppleDetachment appleSubject={account.appleAccount.appleSubject} {...props} />;
  }
}

function AppleDetachment({
  appleSubject,
  onBack,
  ...props
}: Omit<Parameters<typeof DetachFromAppleFlow>[0], "apple">) {
  const apple = useAppleIdentity();
  // Apple login was switched off after this identity was saved: there is nothing to sign in with.
  if (!apple) return <AppleLoginUnavailable onBack={onBack} />;
  return (
    <DetachFromAppleFlow apple={apple} appleSubject={appleSubject} onBack={onBack} {...props} />
  );
}

function AppleLoginUnavailable({ onBack }: { onBack: () => void }) {
  return (
    <PassportScreen className="gap-6">
      <DisplayHeading accent="unavailable." aria-label="Apple login unavailable.">
        Apple login{" "}
      </DisplayHeading>
      <LeadText>
        Apple login is turned off on this Passport, so it cannot remove the key from iCloud right
        now. Your identity stays on this device.
      </LeadText>
      <BackButton className="mt-auto" onClick={onBack} />
    </PassportScreen>
  );
}

export { DetachFromProviderFlow };
