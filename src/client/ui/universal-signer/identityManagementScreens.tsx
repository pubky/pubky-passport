import { useState } from "react";

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
import { VerifyBackupPage } from "@/client/ui/identity-dashboard/management/verify-backup/verifyBackupPage";
import { usePassportCollaborators } from "@/client/ui/passportCollaborators";
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
  const { features, homeserver, httpRelay } = usePassportProvider();
  const { createRingBackupVerifier } = usePassportCollaborators();
  // One verifier for this management session; each check starts it afresh and disposes it.
  const [ringVerifier] = useState(() => createRingBackupVerifier(httpRelay));
  if (navigation.view === "detach") {
    const publicKeyZ32 = navigation.identity.publicIdentity.publicKeyZ32;
    return (
      <DetachFromGoogleFlow
        createRecoveryFile={actions.createRecoveryFile}
        verifyRecoveryFile={actions.verifyRecoveryFile}
        createMigration={() => actions.createMigration(publicKeyZ32)}
        googleAccount={navigation.googleAccount}
        identity={navigation.identity}
        onBack={() => onNavigate({ view: "manage", publicKeyZ32 })}
        // Detaching starts in Manage identity, so finishing returns there, like attaching.
        onDone={() => onNavigate({ view: "manage", publicKeyZ32 })}
      />
    );
  }

  const publicKeyZ32 = navigation.publicKeyZ32;
  const backToManage = () => onNavigate({ view: "manage", publicKeyZ32 });
  // A backup asked for by the logout confirmation returns to that confirmation.
  const logout = "logout" in navigation && navigation.logout ? { logout: true as const } : {};
  switch (navigation.view) {
    case "backup-to-google":
      return <BackupToGoogle publicIdentity={{ publicKeyZ32 }} onBack={backToManage} />;
    case "recovery":
      return (
        <RecoveryFileDownload
          // The logout that asked for this backup deletes the key next, so the file must open.
          allowSkip={!navigation.logout}
          createRecoveryFile={actions.createRecoveryFile}
          verifyRecoveryFile={actions.verifyRecoveryFile}
          publicKeyZ32={publicKeyZ32}
          onBack={
            navigation.home ? onHome : () => onNavigate({ view: "manage", publicKeyZ32, ...logout })
          }
        />
      );
    case "verify": {
      const identity = findIdentity(catalog, publicKeyZ32);
      if (!identity) return null;
      const from = navigation.from;
      return (
        <VerifyBackupPage
          identity={identity}
          onBack={
            from === "home"
              ? onHome
              : from === "logout"
                ? () => onNavigate({ view: "manage", publicKeyZ32, logout: true })
                : from === "ring"
                  ? () => onNavigate({ view: "ring", publicKeyZ32 })
                  : backToManage
          }
          // A check that passes goes straight to Manage identity, where its "Last verified" shows,
          // from the overview's warning as from Manage, and after the export, where the page is a
          // step of its own (Skip for now leads there too). Only the removal confirmation that
          // asked for the check gets it back.
          onDone={from === "logout" ? undefined : backToManage}
          skippable={from === "ring"}
          verifier={ringVerifier}
          verifyRecoveryFile={actions.verifyRecoveryFile}
        />
      );
    }
    case "ring":
      return (
        <MigrateToPubkyRing
          createMigration={() => actions.createMigration(publicKeyZ32)}
          navigationAction="back"
          onBack={backToManage}
          onContinue={() => onNavigate({ view: "verify", publicKeyZ32, from: "ring" })}
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
              onNavigate({ view: "detach", identity, googleAccount: identity.googleAccount });
          }}
          onDownloadRecoveryFile={(returnTo) =>
            onNavigate({
              view: "recovery",
              publicKeyZ32,
              ...(returnTo === "logout" ? { logout: true as const } : {}),
            })
          }
          onRemoveLocalIdentity={() => onRemoveLocalIdentity(publicKeyZ32)}
          onMigrateToKeychain={() => onNavigate({ view: "ring", publicKeyZ32 })}
          onVerifyBackup={(returnTo) =>
            onNavigate({
              view: "verify",
              publicKeyZ32,
              ...(returnTo === "logout" ? { from: "logout" as const } : {}),
            })
          }
          resolveHomeserver={actions.resolveHomeserver}
          republishHomeserver={actions.republishHomeserver}
        />
      );
    }
  }
}
