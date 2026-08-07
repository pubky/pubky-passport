"use client";

import { Result } from "better-result";
import { useReducer } from "react";

import type { PassportIdentityController, PassportIdentityList } from "../../browser/identity/passportIdentity";
import { IdentitySelectionFlow } from "../identity-catalog/selection/identitySelectionFlow";
import { useIdentityCatalog } from "../identity-catalog/useIdentityCatalog";
import { SignInFlow } from "../onboarding/signInFlow";
import { Spinner } from "../shared/primitives/spinner";
import { IdentityManagement } from "./management/identityManagement";
import { DetachFromGoogleFlow } from "./management/detach-from-google/detachFromGoogleFlow";
import { EncryptedBackup } from "./management/encrypted-backup/encryptedBackup";
import { MigrateToPubkyRing } from "./management/migrate-to-pubky-ring/migrateToPubkyRing";
import { IdentityOverview } from "./overview/identityOverview";
import {
  initialIdentityDashboardState,
  resolveIdentityDashboardState,
  transitionIdentityDashboard,
} from "./identityDashboardState";

function IdentityDashboard({ googleClientId, homegateBaseUrl }: {
  googleClientId: string;
  homegateBaseUrl: string;
}) {
  const session = useIdentityCatalog(googleClientId, homegateBaseUrl);

  if (session.status === "loading") {
    return <main aria-label="Checking login state" className="grid min-h-[calc(100svh-84px)] place-items-center"><Spinner /></main>;
  }
  if (session.status === "unavailable") {
    return <main className="grid min-h-[calc(100svh-84px)] place-items-center px-6 text-center text-muted-foreground">Local identity storage is unavailable.</main>;
  }
  return <ReadyIdentityDashboard catalog={session.catalog} controller={session.controller} />;
}

function ReadyIdentityDashboard({ catalog, controller }: {
  catalog: PassportIdentityList;
  controller: PassportIdentityController;
}) {
  const [navigation, dispatch] = useReducer(
    transitionIdentityDashboard,
    catalog,
    initialIdentityDashboardState,
  );
  const state = resolveIdentityDashboardState(navigation, catalog);
  const activeIdentity = catalog.identities.find((identity) => identity.id === catalog.activeIdentityId);

  switch (state.view) {
    case "onboarding":
      return <SignInFlow controller={controller} onComplete={() => dispatch({ type: "onboarding-completed" })} />;
    case "select-identity":
      return <IdentitySelectionFlow
        catalog={catalog}
        controller={controller}
        onBack={() => dispatch({ type: "back-to-overview" })}
        onIdentitySelected={() => dispatch({ type: "identity-selected" })}
      />;
    case "manage-identity": {
      const identity = catalog.identities.find((candidate) => candidate.id === state.identityId);
      if (!identity) return null;
      return <IdentityManagement
        identity={identity}
        onBack={() => dispatch({ type: "back-to-overview" })}
        onDetachFromGoogle={() => dispatch({ type: "detachment-requested", identity })}
        onDownloadBackup={() => dispatch({ type: "backup-requested", identityId: identity.id })}
        onLogOut={() => {
          const removed = controller.remove(identity.id);
          if (Result.isOk(removed)) dispatch({ type: "identity-removed" });
        }}
        onMigrateToKeychain={() => {
          const migration = controller.createActivePubkyRingMigrationUrl();
          dispatch({
            type: "migration-requested",
            identityId: identity.id,
            migrationUrl: Result.isOk(migration) ? migration.value : null,
          });
        }}
        resolveHomeserver={controller.resolveHomeserver.bind(controller)}
      />;
    }
    case "encrypted-backup":
      return <EncryptedBackup
        createBackup={controller.createBackup.bind(controller)}
        identityId={state.identityId}
        onBack={() => dispatch({ type: "back-to-management", identityId: state.identityId })}
      />;
    case "migrate-to-pubky-ring":
      return <MigrateToPubkyRing
        migrationUrl={state.migrationUrl}
        onBack={() => dispatch({ type: "back-to-management", identityId: state.identityId })}
      />;
    case "detach-from-google":
      return <DetachFromGoogleFlow
        controller={controller}
        identity={state.identity}
        onBack={() => dispatch({ type: "back-to-management", identityId: state.identity.id })}
        onDone={() => dispatch({ type: "identity-removed" })}
      />;
    case "overview":
      return activeIdentity
        ? <IdentityOverview
            identity={activeIdentity}
            onManage={() => dispatch({ type: "manage-requested", identityId: activeIdentity.id })}
            onSwitch={() => dispatch({ type: "switch-requested" })}
          />
        : <main className="grid min-h-[calc(100svh-84px)] place-items-center px-6 text-center text-muted-foreground">The active identity is unavailable.</main>;
  }
}

export { IdentityDashboard };
