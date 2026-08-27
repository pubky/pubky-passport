"use client";

import { useState } from "react";

import type { LocalIdentityCatalog, LocalIdentityMetadata } from "../../logic/local-identity/localIdentityModels";
import { IdentitySelectionFlow } from "../identity-catalog/selection/identitySelectionFlow";
import { useIdentityCatalog, type IdentityCatalogActions } from "../identity-catalog/useIdentityCatalog";
import { IdentityEstablishmentFlow } from "../onboarding/identityEstablishmentFlow";
import { RotateCcwIcon } from "../shared/actionIcons";
import { ButtonLink } from "../shared/primitives/button";
import { Spinner } from "../shared/primitives/spinner";
import { IdentityManagement } from "./management/identityManagement";
import { DetachFromGoogleFlow } from "./management/detach-from-google/detachFromGoogleFlow";
import { RecoveryFileDownload } from "./management/recovery-file/recoveryFileDownload";
import { MigrateToPubkyRing } from "./management/migrate-to-pubky-ring/migrateToPubkyRing";
import { IdentityOverview } from "./identityOverview";

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
      return <main aria-label="Checking login state" className="grid min-h-[calc(100svh-var(--passport-header-height))] place-items-center"><Spinner /></main>;
    case "unavailable":
      return (
        <main className="grid min-h-[calc(100svh-var(--passport-header-height))] place-items-center px-6 text-center text-muted-foreground">
          <div className="flex flex-col items-center gap-6">
            <p>Local identity storage is unavailable.</p>
            <ButtonLink href="/" size="lg"><RotateCcwIcon />Reload page</ButtonLink>
          </div>
        </main>
      );
    case "ready":
      return <ReadyIdentityDashboard
        catalog={identityCatalogState.catalog}
        actions={identityCatalogState.actions}
      />;
  }
}

function ReadyIdentityDashboard({ actions, catalog }: {
  actions: IdentityCatalogActions;
  catalog: LocalIdentityCatalog;
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
          setNavigation({ view: "overview" });
        }}
      />;
    case "select-identity":
      return <IdentitySelectionFlow
        catalog={catalog}
        onBack={() => setNavigation({ view: "overview" })}
        onIdentitySelected={() => setNavigation({ view: "overview" })}
        selectIdentity={actions.selectIdentity}
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
        onRemoveLocalIdentity={() => actions.removeIdentity(publicKeyZ32)}
        onMigrateToKeychain={() => {
          setNavigation({
            view: "migrate-to-pubky-ring",
            publicKeyZ32,
          });
        }}
        resolveHomeserver={actions.resolveHomeserver}
      />;
    }
    case "recovery-file":
      return <RecoveryFileDownload
        createRecoveryFile={actions.createRecoveryFile}
        publicKeyZ32={state.publicKeyZ32}
        onBack={() => setNavigation({ view: "manage-identity", publicKeyZ32: state.publicKeyZ32 })}
      />;
    case "migrate-to-pubky-ring":
      return <MigrateToPubkyRing
        createMigrationUrl={() => {
          return actions.createMigrationUrl(state.publicKeyZ32);
        }}
        navigationAction="back"
        onBack={() => setNavigation({ view: "manage-identity", publicKeyZ32: state.publicKeyZ32 })}
      />;
    case "detach-from-google":
      return <DetachFromGoogleFlow
        createRecoveryFile={actions.createRecoveryFile}
        createMigrationUrl={() => {
          // Detachment must back up the same identity that it will remove.
          return actions.createMigrationUrl(state.identity.publicIdentity.publicKeyZ32);
        }}
        googleSubject={state.googleSubject}
        identity={state.identity}
        onBack={() => setNavigation({
          view: "manage-identity",
          publicKeyZ32: state.identity.publicIdentity.publicKeyZ32,
        })}
        onDone={() => {
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
        : <IdentitySelectionFlow
          catalog={catalog}
          onBack={() => setNavigation({ view: "overview" })}
          onIdentitySelected={() => setNavigation({ view: "overview" })}
          selectIdentity={actions.selectIdentity}
        />;
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
