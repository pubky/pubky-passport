"use client";

import { Result } from "better-result";
import { useState } from "react";

import type { LocalIdentityController } from "../../logic/local-identity/LocalIdentityController";
import type { LocalIdentityCatalog, LocalIdentityMetadata } from "../../logic/local-identity/localIdentityModels";
import type { GoogleIdentityConfiguration } from "../../logic/google-identity/GoogleIdentityController";
import { IdentitySelectionFlow } from "../identity-catalog/selection/identitySelectionFlow";
import { useIdentityCatalog } from "../identity-catalog/useIdentityCatalog";
import { SignInFlow } from "../onboarding/signInFlow";
import { Spinner } from "../shared/primitives/spinner";
import { IdentityManagement } from "./management/identityManagement";
import { DetachFromGoogleFlow } from "./management/detach-from-google/detachFromGoogleFlow";
import { EncryptedBackup } from "./management/encrypted-backup/encryptedBackup";
import { MigrateToPubkyRing } from "./management/migrate-to-pubky-ring/migrateToPubkyRing";
import { IdentityOverview } from "./overview/identityOverview";

type IdentityDashboardView =
  | { view: "onboarding" }
  | { view: "overview" }
  | { view: "select-identity" }
  | { view: "manage-identity"; publicKeyZ32: string }
  | { view: "encrypted-backup"; publicKeyZ32: string }
  | { view: "migrate-to-pubky-ring"; publicKeyZ32: string; migrationUrl: string | null }
  | { view: "detach-from-google"; identity: LocalIdentityMetadata };

function IdentityDashboard({ googleClientId, homegateBaseUrl }: {
  googleClientId: string;
  homegateBaseUrl: string;
}) {
  const session = useIdentityCatalog();
  const googleIdentityConfiguration = { googleClientId, homegateBaseUrl };

  switch (session.status) {
    case "loading":
      return <main aria-label="Checking login state" className="grid min-h-[calc(100svh-84px)] place-items-center"><Spinner /></main>;
    case "unavailable":
      return <main className="grid min-h-[calc(100svh-84px)] place-items-center px-6 text-center text-muted-foreground">Local identity storage is unavailable.</main>;
    case "ready":
      return <ReadyIdentityDashboard
        catalog={session.catalog}
        localIdentityController={session.localIdentityController}
        googleIdentityConfiguration={googleIdentityConfiguration}
        onIdentitiesChanged={session.reloadIdentities}
      />;
  }
}

function ReadyIdentityDashboard({ catalog, localIdentityController, googleIdentityConfiguration, onIdentitiesChanged }: {
  catalog: LocalIdentityCatalog;
  localIdentityController: LocalIdentityController;
  googleIdentityConfiguration: GoogleIdentityConfiguration;
  onIdentitiesChanged: () => void;
}) {
  const [navigation, setNavigation] = useState<IdentityDashboardView>(() => (
    catalog.identities.length === 0 ? { view: "onboarding" } : { view: "overview" }
  ));
  const state = resolveIdentityDashboardView(navigation, catalog);
  const activeIdentity = catalog.identities.find(
    (identity) => identity.publicIdentity.publicKeyZ32 === catalog.activePublicKeyZ32,
  );

  switch (state.view) {
    case "onboarding":
      return <SignInFlow
        googleIdentityConfiguration={googleIdentityConfiguration}
        onComplete={() => {
          onIdentitiesChanged();
          setNavigation({ view: "overview" });
        }}
      />;
    case "select-identity":
      return <IdentitySelectionFlow
        catalog={catalog}
        googleIdentityConfiguration={googleIdentityConfiguration}
        onBack={() => setNavigation({ view: "overview" })}
        onIdentitySelected={() => {
          onIdentitiesChanged();
          setNavigation({ view: "overview" });
        }}
        selectIdentity={(publicKeyZ32) => Result.isOk(localIdentityController.selectIdentity(publicKeyZ32))}
      />;
    case "manage-identity": {
      const identity = catalog.identities.find(
        (candidate) => candidate.publicIdentity.publicKeyZ32 === state.publicKeyZ32,
      );
      if (!identity) return null;
      const publicKeyZ32 = identity.publicIdentity.publicKeyZ32;
      return <IdentityManagement
        identity={identity}
        onBack={() => setNavigation({ view: "overview" })}
        onDetachFromGoogle={() => setNavigation({ view: "detach-from-google", identity })}
        onDownloadBackup={() => setNavigation({ view: "encrypted-backup", publicKeyZ32 })}
        onLogOut={() => {
          const removed = localIdentityController.removeIdentity(publicKeyZ32);
          if (Result.isOk(removed)) {
            onIdentitiesChanged();
            setNavigation({ view: "overview" });
          }
        }}
        onMigrateToKeychain={() => {
          const migration = localIdentityController.createPubkyRingMigrationUrl(publicKeyZ32);
          setNavigation({
            view: "migrate-to-pubky-ring",
            publicKeyZ32,
            migrationUrl: Result.isOk(migration) ? migration.value : null,
          });
        }}
        resolveHomeserver={localIdentityController.resolveHomeserver}
      />;
    }
    case "encrypted-backup":
      return <EncryptedBackup
        createBackup={localIdentityController.createEncryptedBackup}
        publicKeyZ32={state.publicKeyZ32}
        onBack={() => setNavigation({ view: "manage-identity", publicKeyZ32: state.publicKeyZ32 })}
      />;
    case "migrate-to-pubky-ring":
      return <MigrateToPubkyRing
        migrationUrl={state.migrationUrl}
        onBack={() => setNavigation({ view: "manage-identity", publicKeyZ32: state.publicKeyZ32 })}
      />;
    case "detach-from-google":
      return <DetachFromGoogleFlow
        createBackup={localIdentityController.createEncryptedBackup}
        createMigrationUrl={() => {
          // Detachment must back up the same identity that it will remove.
          const migration = localIdentityController.createPubkyRingMigrationUrl(
            state.identity.publicIdentity.publicKeyZ32,
          );
          return Result.isOk(migration) ? migration.value : null;
        }}
        googleIdentityConfiguration={googleIdentityConfiguration}
        identity={state.identity}
        onBack={() => setNavigation({
          view: "manage-identity",
          publicKeyZ32: state.identity.publicIdentity.publicKeyZ32,
        })}
        onDone={() => {
          onIdentitiesChanged();
          setNavigation({ view: "overview" });
        }}
      />;
    case "overview":
      return activeIdentity
        ? <IdentityOverview
          identity={activeIdentity}
          onManage={() => setNavigation({
            view: "manage-identity",
            publicKeyZ32: activeIdentity.publicIdentity.publicKeyZ32,
          })}
          onSwitch={() => setNavigation({ view: "select-identity" })}
        />
        : <main className="grid min-h-[calc(100svh-84px)] place-items-center px-6 text-center text-muted-foreground">The active identity is unavailable.</main>;
  }
}

function resolveIdentityDashboardView(
  state: IdentityDashboardView,
  catalog: LocalIdentityCatalog,
): IdentityDashboardView {
  if (state.view === "detach-from-google" || state.view === "onboarding") return state;
  if (catalog.identities.length === 0) return { view: "onboarding" };
  if ("publicKeyZ32" in state
    && !catalog.identities.some((identity) => identity.publicIdentity.publicKeyZ32 === state.publicKeyZ32)) {
    return { view: "overview" };
  }
  return state;
}

export { IdentityDashboard };
