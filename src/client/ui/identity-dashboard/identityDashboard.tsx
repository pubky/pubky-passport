"use client";

import { Result } from "better-result";
import { useState } from "react";

import type { LocalIdentityController } from "../../logic/local-identity/LocalIdentityController";
import type { LocalIdentityCatalog, LocalIdentityMetadata } from "../../logic/local-identity/localIdentityModels";
import { IdentitySelectionFlow } from "../identity-catalog/selection/identitySelectionFlow";
import { useIdentityCatalog } from "../identity-catalog/useIdentityCatalog";
import { IdentityEstablishmentFlow } from "../onboarding/identityEstablishmentFlow";
import { RotateCcwIcon } from "../shared/actionIcons";
import { ButtonLink } from "../shared/primitives/button";
import { Spinner } from "../shared/primitives/spinner";
import { IdentityManagement } from "./management/identityManagement";
import { DetachFromGoogleFlow } from "./management/detach-from-google/detachFromGoogleFlow";
import { RecoveryFileDownload } from "./management/recovery-file/recoveryFileDownload";
import { MigrateToPubkyRing } from "./management/migrate-to-pubky-ring/migrateToPubkyRing";
import { IdentityOverview } from "./overview/identityOverview";

type IdentityDashboardView =
  | { view: "onboarding" }
  | { view: "overview" }
  | { view: "select-identity" }
  | { view: "manage-identity"; publicKeyZ32: string }
  | { view: "recovery-file"; publicKeyZ32: string }
  | { view: "migrate-to-pubky-ring"; publicKeyZ32: string }
  | { view: "detach-from-google"; googleSubject: string; identity: LocalIdentityMetadata };

function IdentityDashboard() {
  const identityCatalogState = useIdentityCatalog();

  switch (identityCatalogState.status) {
    case "loading":
      return <main aria-label="Checking login state" className="grid min-h-[calc(100svh-84px)] place-items-center"><Spinner /></main>;
    case "unavailable":
      return (
        <main className="grid min-h-[calc(100svh-84px)] place-items-center px-6 text-center text-muted-foreground">
          <div className="flex flex-col items-center gap-6">
            <p>Local identity storage is unavailable.</p>
            <ButtonLink href="/" size="lg"><RotateCcwIcon />Reload page</ButtonLink>
          </div>
        </main>
      );
    case "ready":
      return <ReadyIdentityDashboard
        catalog={identityCatalogState.catalog}
        localIdentityController={identityCatalogState.localIdentityController}
        refreshIdentityCatalog={identityCatalogState.refreshIdentityCatalog}
      />;
  }
}

function ReadyIdentityDashboard({ catalog, localIdentityController, refreshIdentityCatalog }: {
  catalog: LocalIdentityCatalog;
  localIdentityController: LocalIdentityController;
  refreshIdentityCatalog: () => void;
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
      return <IdentityEstablishmentFlow
        onComplete={() => {
          refreshIdentityCatalog();
          setNavigation({ view: "overview" });
        }}
      />;
    case "select-identity":
      return <IdentitySelectionFlow
        catalog={catalog}
        onBack={() => setNavigation({ view: "overview" })}
        onIdentitySelected={() => {
          refreshIdentityCatalog();
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
        onDetachFromGoogle={() => {
          if (identity.googleAccount) {
            setNavigation({
              view: "detach-from-google",
              googleSubject: identity.googleAccount.googleSubject,
              identity,
            });
          }
        }}
        onDownloadRecoveryFile={() => setNavigation({ view: "recovery-file", publicKeyZ32 })}
        onRemoveLocalIdentity={() => {
          const removed = localIdentityController.removeIdentity(publicKeyZ32);
          if (Result.isOk(removed)) {
            refreshIdentityCatalog();
            setNavigation({ view: "overview" });
          }
        }}
        onMigrateToKeychain={() => {
          setNavigation({
            view: "migrate-to-pubky-ring",
            publicKeyZ32,
          });
        }}
        resolveHomeserver={localIdentityController.resolveHomeserver}
      />;
    }
    case "recovery-file":
      return <RecoveryFileDownload
        createRecoveryFile={localIdentityController.createRecoveryFile}
        publicKeyZ32={state.publicKeyZ32}
        onBack={() => setNavigation({ view: "manage-identity", publicKeyZ32: state.publicKeyZ32 })}
      />;
    case "migrate-to-pubky-ring":
      return <MigrateToPubkyRing
        createMigrationUrl={() => {
          const migration = localIdentityController.createPubkyRingMigrationUrl(state.publicKeyZ32);
          return Result.isOk(migration) ? migration.value : null;
        }}
        onBack={() => setNavigation({ view: "manage-identity", publicKeyZ32: state.publicKeyZ32 })}
      />;
    case "detach-from-google":
      return <DetachFromGoogleFlow
        createRecoveryFile={localIdentityController.createRecoveryFile}
        createMigrationUrl={() => {
          // Detachment must back up the same identity that it will remove.
          const migration = localIdentityController.createPubkyRingMigrationUrl(
            state.identity.publicIdentity.publicKeyZ32,
          );
          return Result.isOk(migration) ? migration.value : null;
        }}
        googleSubject={state.googleSubject}
        identity={state.identity}
        onBack={() => setNavigation({
          view: "manage-identity",
          publicKeyZ32: state.identity.publicIdentity.publicKeyZ32,
        })}
        onDone={() => {
          refreshIdentityCatalog();
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
