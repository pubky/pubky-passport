"use client";

import { Result } from "better-result";
import { useReducer, useState } from "react";

import type { LocalIdentityCatalog, PassportIdentityController } from "../../logic/identity/passportIdentityController";
import { IdentitySelectionFlow } from "../identity-catalog/selection/identitySelectionFlow";
import { useIdentityCatalog } from "../identity-catalog/useIdentityCatalog";
import { SignInFlow } from "../onboarding/signInFlow";
import { GoogleIdentityComplete } from "../onboarding/google/googleIdentityComplete";
import type { GoogleIdentityEstablished } from "../onboarding/google/useGoogleSignIn";
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
  const [completion, setCompletion] = useState<GoogleIdentityEstablished | null>(null);

  if (completion) {
    return <GoogleIdentityComplete
      googleAccount={completion.googleAccount}
      identity={completion.identity}
      mode={completion.mode}
      onContinue={() => setCompletion(null)}
    />;
  }

  switch (session.status) {
    case "loading":
      return <main aria-label="Checking login state" className="grid min-h-[calc(100svh-84px)] place-items-center"><Spinner /></main>;
    case "unavailable":
      return <main className="grid min-h-[calc(100svh-84px)] place-items-center px-6 text-center text-muted-foreground">Local identity storage is unavailable.</main>;
    case "ready":
      return <ReadyIdentityDashboard
        catalog={session.catalog}
        controller={session.controller}
        onIdentitiesChanged={session.reloadIdentities}
        onIdentityEstablished={(identity) => {
          session.reloadIdentities();
          setCompletion(identity);
        }}
      />;
  }
}

function ReadyIdentityDashboard({ catalog, controller, onIdentitiesChanged, onIdentityEstablished }: {
  catalog: LocalIdentityCatalog;
  controller: PassportIdentityController;
  onIdentitiesChanged: () => void;
  onIdentityEstablished: (identity: GoogleIdentityEstablished) => void;
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
      return <SignInFlow
        controller={controller}
        onComplete={() => dispatch({ type: "onboarding-completed" })}
        onEstablished={onIdentityEstablished}
      />;
    case "select-identity":
      return <IdentitySelectionFlow
        catalog={catalog}
        controller={controller}
        onBack={() => dispatch({ type: "back-to-overview" })}
        onIdentityEstablished={onIdentityEstablished}
        onIdentitySelected={() => {
          onIdentitiesChanged();
          dispatch({ type: "identity-selected" });
        }}
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
          const removed = controller.removeIdentity(identity.id);
          if (Result.isOk(removed)) {
            onIdentitiesChanged();
            dispatch({ type: "identity-removed" });
          }
        }}
        onMigrateToKeychain={() => {
          const migration = controller.createPubkyRingMigrationUrl();
          dispatch({
            type: "migration-requested",
            identityId: identity.id,
            migrationUrl: Result.isOk(migration) ? migration.value : null,
          });
        }}
        resolveHomeserver={controller.resolveHomeserver}
      />;
    }
    case "encrypted-backup":
      return <EncryptedBackup
        createBackup={controller.createEncryptedBackup}
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
        onDone={() => {
          onIdentitiesChanged();
          dispatch({ type: "identity-removed" });
        }}
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
