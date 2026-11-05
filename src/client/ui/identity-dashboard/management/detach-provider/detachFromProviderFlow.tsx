import type { LocalIdentityRecoveryFileResult } from "@/client/logic/local-identity/LocalIdentityController";
import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type {
  IdentityProviderAccount,
  LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";
import type { PubkyRingMigration } from "@/client/logic/pubky/PubkySdkAdapter";
import { DetachFromGoogleFlow } from "@/client/ui/identity-dashboard/management/detach-from-google/detachFromGoogleFlow";

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
  }
}

export { DetachFromProviderFlow };
