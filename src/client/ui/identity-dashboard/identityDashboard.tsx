"use client";

import { Result } from "better-result";
import { useReducer, useState } from "react";

import type { LocalIdentityController } from "../../logic/local-identity/LocalIdentityController";
import type { LocalIdentityCatalog } from "../../logic/local-identity/localIdentityModels";
import type { GoogleIdentityConfiguration } from "../../logic/google-identity/GoogleIdentityController";
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
  const session = useIdentityCatalog();
  const googleIdentityConfiguration = { googleClientId, homegateBaseUrl };
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
        googleIdentityConfiguration={googleIdentityConfiguration}
        onIdentitiesChanged={session.reloadIdentities}
        onIdentityEstablished={(identity) => {
          session.reloadIdentities();
          setCompletion(identity);
        }}
      />;
  }
}

function ReadyIdentityDashboard({ catalog, controller, googleIdentityConfiguration, onIdentitiesChanged, onIdentityEstablished }: {
  catalog: LocalIdentityCatalog;
  controller: LocalIdentityController;
  googleIdentityConfiguration: GoogleIdentityConfiguration;
  onIdentitiesChanged: () => void;
  onIdentityEstablished: (identity: GoogleIdentityEstablished) => void;
}) {
  const [navigation, dispatch] = useReducer(
    transitionIdentityDashboard,
    catalog,
    initialIdentityDashboardState,
  );
  const state = resolveIdentityDashboardState(navigation, catalog);
  const activeIdentity = catalog.identities.find(
    (identity) => identity.publicIdentity.publicKeyZ32 === catalog.activePublicKeyZ32,
  );

  switch (state.view) {
    case "onboarding":
      return <SignInFlow
        googleIdentityConfiguration={googleIdentityConfiguration}
        onComplete={() => dispatch({ type: "onboarding-completed" })}
        onEstablished={onIdentityEstablished}
      />;
    case "select-identity":
      return <IdentitySelectionFlow
        catalog={catalog}
        googleIdentityConfiguration={googleIdentityConfiguration}
        onBack={() => dispatch({ type: "back-to-overview" })}
        onIdentityEstablished={onIdentityEstablished}
        onIdentitySelected={() => {
          onIdentitiesChanged();
          dispatch({ type: "identity-selected" });
        }}
        selectIdentity={(publicKeyZ32) => Result.isOk(controller.selectIdentity(publicKeyZ32))}
      />;
    case "manage-identity": {
      const identity = catalog.identities.find(
        (candidate) => candidate.publicIdentity.publicKeyZ32 === state.publicKeyZ32,
      );
      if (!identity) return null;
      const publicKeyZ32 = identity.publicIdentity.publicKeyZ32;
      return <IdentityManagement
        identity={identity}
        onBack={() => dispatch({ type: "back-to-overview" })}
        onDetachFromGoogle={() => dispatch({ type: "detachment-requested", identity })}
        onDownloadBackup={() => dispatch({ type: "backup-requested", publicKeyZ32 })}
        onLogOut={() => {
          const removed = controller.removeIdentity(publicKeyZ32);
          if (Result.isOk(removed)) {
            onIdentitiesChanged();
            dispatch({ type: "identity-removed" });
          }
        }}
        onMigrateToKeychain={() => {
          const migration = controller.createPubkyRingMigrationUrl();
          dispatch({
            type: "migration-requested",
            publicKeyZ32,
            migrationUrl: Result.isOk(migration) ? migration.value : null,
          });
        }}
        resolveHomeserver={controller.resolveHomeserver}
      />;
    }
    case "encrypted-backup":
      return <EncryptedBackup
        createBackup={controller.createEncryptedBackup}
        publicKeyZ32={state.publicKeyZ32}
        onBack={() => dispatch({ type: "back-to-management", publicKeyZ32: state.publicKeyZ32 })}
      />;
    case "migrate-to-pubky-ring":
      return <MigrateToPubkyRing
        migrationUrl={state.migrationUrl}
        onBack={() => dispatch({ type: "back-to-management", publicKeyZ32: state.publicKeyZ32 })}
      />;
    case "detach-from-google":
      return <DetachFromGoogleFlow
        createBackup={controller.createEncryptedBackup}
        createMigrationUrl={() => {
          const migration = controller.createPubkyRingMigrationUrl();
          return Result.isOk(migration) ? migration.value : null;
        }}
        googleIdentityConfiguration={googleIdentityConfiguration}
        identity={state.identity}
        onBack={() => dispatch({
          type: "back-to-management",
          publicKeyZ32: state.identity.publicIdentity.publicKeyZ32,
        })}
        onDone={() => {
          onIdentitiesChanged();
          dispatch({ type: "identity-removed" });
        }}
      />;
    case "overview":
      return activeIdentity
        ? <IdentityOverview
          identity={activeIdentity}
          onManage={() => dispatch({
            type: "manage-requested",
            publicKeyZ32: activeIdentity.publicIdentity.publicKeyZ32,
          })}
          onSwitch={() => dispatch({ type: "switch-requested" })}
        />
        : <main className="grid min-h-[calc(100svh-84px)] place-items-center px-6 text-center text-muted-foreground">The active identity is unavailable.</main>;
  }
}

export { IdentityDashboard };
