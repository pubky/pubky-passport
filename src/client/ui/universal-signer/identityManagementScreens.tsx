import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";
import {
  findIdentity,
  type ManagementNavigation,
} from "@/client/logic/universal-signer/signerNavigation";
import type { IdentityCatalogActions } from "@/client/ui/identity-catalog/useIdentityCatalog";
import { BackupToGoogle } from "@/client/ui/identity-dashboard/management/backupToGoogle";
import { DetachFromGoogleFlow } from "@/client/ui/identity-dashboard/management/detach-from-google/detachFromGoogleFlow";
import { IdentityManagement } from "@/client/ui/identity-dashboard/management/identityManagement";
import { MigrateToPubkyRing } from "@/client/ui/identity-dashboard/management/migrate-to-pubky-ring/migrateToPubkyRing";
import { RecoveryFileDownload } from "@/client/ui/identity-dashboard/management/recovery-file/recoveryFileDownload";
import { usePassportProvider } from "@/client/ui/passportProviderConfiguration";

/** One identity's management screens. The shell owns the navigation between them. */
export function IdentityManagementScreens({
  actions,
  catalog,
  navigation,
  onEditProfile,
  onHome,
  onNavigate,
  onRemoveLocalIdentity,
}: {
  actions: IdentityCatalogActions;
  catalog: LocalIdentityCatalog;
  navigation: ManagementNavigation;
  onEditProfile: (publicKeyZ32: string) => void;
  onHome: () => void;
  onNavigate: (navigation: ManagementNavigation) => void;
  onRemoveLocalIdentity: (publicKeyZ32: string) => LocalIdentityResult<void>;
}) {
  const { features, homeserver } = usePassportProvider();
  if (navigation.view === "detach") {
    const publicKeyZ32 = navigation.identity.publicIdentity.publicKeyZ32;
    return (
      <DetachFromGoogleFlow
        createRecoveryFile={actions.createRecoveryFile}
        verifyRecoveryFile={actions.verifyRecoveryFile}
        createMigration={() => actions.createMigration(publicKeyZ32)}
        googleSubject={navigation.googleSubject}
        identity={navigation.identity}
        onBack={() => onNavigate({ view: "manage", publicKeyZ32 })}
        onDone={onHome}
      />
    );
  }

  const publicKeyZ32 = navigation.publicKeyZ32;
  const backToManage = () => onNavigate({ view: "manage", publicKeyZ32 });
  // A backup asked for by the logout confirmation returns to that confirmation.
  const logout = navigation.logout ? { logout: true as const } : {};
  switch (navigation.view) {
    case "backup-to-google":
      return <BackupToGoogle publicIdentity={{ publicKeyZ32 }} onBack={backToManage} />;
    case "recovery":
      return (
        <RecoveryFileDownload
          // The logout that asked for this backup deletes the key next, so the file must open.
          allowSkip={!navigation.logout}
          check={navigation.check === true}
          createRecoveryFile={actions.createRecoveryFile}
          verifyRecoveryFile={actions.verifyRecoveryFile}
          publicKeyZ32={publicKeyZ32}
          onBack={
            navigation.home ? onHome : () => onNavigate({ view: "manage", publicKeyZ32, ...logout })
          }
        />
      );
    case "ring":
      return (
        <MigrateToPubkyRing
          createMigration={() => actions.createMigration(publicKeyZ32)}
          navigationAction="back"
          onBack={backToManage}
        />
      );
    case "manage": {
      const identity = findIdentity(catalog, publicKeyZ32);
      if (!identity) return null;
      return (
        <IdentityManagement
          key={publicKeyZ32}
          identity={identity}
          confirmLogout={navigation.logout === true}
          providerHomeserver={homeserver ?? undefined}
          onEditProfile={() => onEditProfile(publicKeyZ32)}
          {...(features.google
            ? { onBackupToGoogle: () => onNavigate({ view: "backup-to-google", publicKeyZ32 }) }
            : {})}
          onBack={onHome}
          onDetachFromGoogle={() => {
            if (identity.googleAccount)
              onNavigate({
                view: "detach",
                identity,
                googleSubject: identity.googleAccount.googleSubject,
              });
          }}
          onDownloadRecoveryFile={(returnTo, check) =>
            onNavigate({
              view: "recovery",
              publicKeyZ32,
              ...(returnTo === "logout" ? { logout: true as const } : {}),
              ...(check ? { check: true as const } : {}),
            })
          }
          onRemoveLocalIdentity={() => onRemoveLocalIdentity(publicKeyZ32)}
          onMigrateToKeychain={() => onNavigate({ view: "ring", publicKeyZ32 })}
          resolveHomeserver={actions.resolveHomeserver}
          republishHomeserver={actions.republishHomeserver}
        />
      );
    }
  }
}
