"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Result } from "better-result";
import { Button } from "@/client/ui/shared/primitives/button";
import { CheckIcon } from "@/client/ui/shared/icons";

import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import { RingProfileEditor } from "@/client/logic/profile/RingProfileEditor";
import type {
  LocalIdentityCatalog,
  LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";
import {
  findIdentity,
  initialSignerNavigation,
  requiresProfileSetup,
  resolveSignerNavigation,
  type SignerNavigation,
} from "@/client/logic/universal-signer/signerNavigation";
import { AuthorizationFlow } from "@/client/ui/authorization/authorizationFlow";
import { ManualAuthorization } from "@/client/ui/authorization/manual-entry/manualAuthorization";
import { SignInBand } from "@/client/ui/authorization/signInBand";
import {
  usePassportAuthorization,
  type AuthorizationController,
} from "@/client/ui/authorization/usePassportAuthorization";
import {
  useIdentityCatalog,
  type IdentityCatalogActions,
} from "@/client/ui/identity-catalog/useIdentityCatalog";
import { IdentitySelectionFlow } from "@/client/ui/identity-catalog/selection/identitySelectionFlow";
import { IdentityOverview } from "@/client/ui/identity-dashboard/identityOverview";
import { BackupImportFlow } from "@/client/ui/local-account/backupImportFlow";
import { CreateAccountFlow } from "@/client/ui/onboarding/create-account/createAccountFlow";
import { BackButton } from "@/client/ui/shared/backButton";
import { CancelButton } from "@/client/ui/shared/cancelButton";
import { LoadingScreen } from "@/client/ui/shared/loadingScreen";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { AddIdentity } from "./addIdentity";
import { ExternalSignerRequest } from "./externalSignerRequest";
import { IdentityManagementScreens } from "./identityManagementScreens";
import { useIdentityProfiles } from "@/client/ui/profile/useIdentityProfiles";
import { ProfileSetupFlow } from "@/client/ui/profile/profileSetupFlow";
import { RingProfileConnection } from "@/client/ui/profile/ringProfileConnection";
import { usePassportCollaborators } from "@/client/ui/passportCollaborators";
import { usePassportProvider } from "@/client/ui/passportProviderConfiguration";

export function UniversalSignerFlow() {
  const { controller, state: authorization } = usePassportAuthorization();
  const identities = useIdentityCatalog();

  if (!controller || !authorization) {
    return <LoadingScreen label="Loading Passport" />;
  }
  if (
    identities.status !== "ready" &&
    authorization.status !== "review" &&
    authorization.status !== "manual-entry"
  ) {
    // Outcomes and approvals in progress stay visible without the catalog; none can switch.
    return (
      <>
        <SignInBand authorization={authorization} />
        <AuthorizationFlow
          authorization={authorization}
          controller={controller}
          onSwitch={() => undefined}
        />
      </>
    );
  }
  if (identities.status === "loading") {
    return <LoadingScreen label="Loading Passport" />;
  }
  if (identities.status === "unavailable") {
    return (
      <>
        <SignInBand authorization={authorization} />
        <PassportScreen className="gap-6">
          <DisplayHeading accent="unavailable.">Storage</DisplayHeading>
          <LeadText>Passport could not read identities stored in this browser.</LeadText>
          <PassportNavigation
            back={
              authorization.status === "review" ? (
                <CancelButton onClick={() => void controller.cancel()} />
              ) : (
                <Button size="lg" variant="outline" onClick={() => window.location.replace("/")}>
                  Try again
                </Button>
              )
            }
          />
        </PassportScreen>
      </>
    );
  }
  return (
    <ReadyPassport
      actions={identities.actions}
      authorization={authorization}
      catalog={identities.catalog}
      controller={controller}
    />
  );
}

function ReadyPassport({
  actions,
  authorization,
  catalog: storedCatalog,
  controller,
}: {
  actions: IdentityCatalogActions;
  authorization: PassportAuthorizationViewState;
  catalog: LocalIdentityCatalog;
  controller: AuthorizationController;
}) {
  const profiles = useIdentityProfiles(storedCatalog);
  const { homeserver: providerHomeserver, httpRelay } = usePassportProvider();
  const { createRingProfileController, readAccountDraft } = usePassportCollaborators();
  const [ringProfile] = useState(() => createRingProfileController(httpRelay));
  useEffect(() => {
    const dispose = () => ringProfile.dispose();
    window.addEventListener("pagehide", dispose);
    return () => {
      window.removeEventListener("pagehide", dispose);
      dispose();
    };
  }, [ringProfile]);
  const ringEditor = useMemo(
    () => new RingProfileEditor(profiles.controller, ringProfile),
    [profiles.controller, ringProfile],
  );
  const catalog = profiles.catalog;
  const hasRequest = authorization.status === "review";
  // "Finish later" keeps setup required but stops forcing the editor for this session.
  const [deferredProfiles, setDeferredProfiles] = useState<ReadonlySet<string>>(() => new Set());
  const context = { catalog, deferredProfiles, requestPending: hasRequest };
  const [storedNavigation, navigate] = useState<SignerNavigation>(() => {
    const draft = readAccountDraft();
    return initialSignerNavigation(context, Result.isOk(draft) ? draft.value : null);
  });
  const navigation = resolveSignerNavigation(storedNavigation, context);
  // The resolved screen is kept, so a setup screen stays open while its own completion changes
  // the catalog (profile setup clears its flag before it reports back).
  if (navigation !== storedNavigation) navigate(navigation);
  const activeIdentity = catalog.activePublicKeyZ32
    ? findIdentity(catalog, catalog.activePublicKeyZ32)
    : undefined;
  const cancelRequest = hasRequest
    ? () => {
        void controller.cancel();
      }
    : undefined;
  const goHome = () => navigate({ view: "home" });
  const addBack = "back" in navigation ? navigation.back : null;
  const selectAddedIdentity = (publicKeyZ32: string) => {
    const selected = actions.selectIdentity(publicKeyZ32);
    navigate(Result.isOk(selected) ? { view: "home" } : { view: "finish-add", publicKeyZ32 });
  };
  const completeAddition = (identity: LocalIdentityMetadata) => {
    const publicKeyZ32 = identity.publicIdentity.publicKeyZ32;
    if (requiresProfileSetup(identity, catalog)) {
      actions.selectIdentity(publicKeyZ32);
      navigate({ view: "profile", publicKeyZ32 });
    } else selectAddedIdentity(publicKeyZ32);
  };
  const deferProfile = (publicKeyZ32: string) => {
    setDeferredProfiles((current) => new Set(current).add(publicKeyZ32));
    navigate({ view: "home" });
  };
  const removeIdentity = (publicKeyZ32: string) => {
    const removed = actions.removeIdentity(publicKeyZ32);
    if (Result.isOk(removed) && ringProfile.isConnected(publicKeyZ32)) ringProfile.dispose();
    return removed;
  };
  const identitySelection = (
    <IdentitySelectionFlow
      catalog={catalog}
      onAddIdentity={() => navigate({ view: "add", back: "switch" })}
      onBack={goHome}
      onIdentitySelected={goHome}
      onShow={profiles.loadAll}
      selectIdentity={actions.selectIdentity}
    />
  );

  function renderScreen(): ReactNode {
    // Once approval begins, no navigation or external handoff can compete with it.
    if (authorization.status !== "review" && authorization.status !== "manual-entry") {
      return (
        <AuthorizationFlow
          authorization={authorization}
          controller={controller}
          identity={activeIdentity}
          onSwitch={() => navigate({ view: "switch" })}
        />
      );
    }
    switch (navigation.view) {
      case "profile": {
        const publicKeyZ32 = navigation.publicKeyZ32;
        const identity = findIdentity(catalog, publicKeyZ32);
        if (!identity) return null;
        const onDefer = identity.profileSetupRequired
          ? () => deferProfile(publicKeyZ32)
          : undefined;
        if (identity.keySource === "ring" && !ringProfile.isConnected(publicKeyZ32)) {
          return (
            <RingProfileConnection
              controller={ringProfile}
              expectedKey={publicKeyZ32}
              setupRequired={identity.profileSetupRequired === true}
              onBack={() => navigate({ view: "manage", publicKeyZ32 })}
              onComplete={() => navigate({ view: "profile", publicKeyZ32 })}
              onDefer={onDefer}
            />
          );
        }
        return (
          <ProfileSetupFlow
            key={publicKeyZ32}
            identity={identity}
            controller={identity.keySource === "ring" ? ringEditor : profiles.controller}
            actions={actions}
            onBack={() => navigate({ view: "manage", publicKeyZ32 })}
            onComplete={(profile, avatar) => {
              profiles.published(publicKeyZ32, profile, avatar);
              selectAddedIdentity(publicKeyZ32);
            }}
            onReconnect={
              identity.keySource === "ring"
                ? () => navigate({ view: "profile", publicKeyZ32 })
                : undefined
            }
            onDefer={onDefer}
          />
        );
      }
      case "finish-add": {
        const publicKeyZ32 = navigation.publicKeyZ32;
        return (
          <PassportScreen className="gap-6">
            <DisplayHeading accent="saved.">Identity</DisplayHeading>
            <LeadText>
              Passport saved your identity but could not select it. Try again to continue.
            </LeadText>
            <PassportNavigation
              back={<BackButton onClick={goHome} />}
              confirm={
                <Button
                  className="w-full"
                  onClick={() => selectAddedIdentity(publicKeyZ32)}
                  size="lg"
                >
                  Select identity
                </Button>
              }
            />
            {cancelRequest ? <CancelButton className="mt-3" onClick={cancelRequest} /> : null}
          </PassportScreen>
        );
      }
      case "add":
        return (
          <AddIdentity
            forAuthorization={hasRequest}
            onUseRing={
              hasRequest
                ? () => navigate({ view: "external", origin: { view: "add", back: addBack } })
                : undefined
            }
            onConnectRing={
              hasRequest ? undefined : () => navigate({ view: "connect-ring", back: addBack })
            }
            onBack={addBack ? () => navigate({ view: addBack }) : undefined}
            onCancel={addBack ? undefined : cancelRequest}
            onComplete={completeAddition}
            onCreateAccount={() => navigate({ view: "create-account", back: addBack })}
            onImport={() => navigate({ view: "import", back: addBack })}
          />
        );
      case "import":
        return (
          <BackupImportFlow
            defaultHomeserver={providerHomeserver}
            onBack={() => navigate({ view: "add", back: addBack })}
            onComplete={completeAddition}
          />
        );
      case "connect-ring":
        // Adds an existing Ring identity; without setup required its profile stays as it is.
        return (
          <RingProfileConnection
            controller={ringProfile}
            onBack={() => navigate({ view: "add", back: addBack })}
            onComplete={completeAddition}
          />
        );
      case "create-account":
        return (
          <CreateAccountFlow
            ringProfileController={ringProfile}
            inviteHomeserver={providerHomeserver ?? ""}
            onBack={() => navigate({ view: "add", back: addBack })}
            onLocalComplete={completeAddition}
          />
        );
      case "switch":
        return identitySelection;
      case "manual":
        return <ManualAuthorization onBack={goHome} />;
      case "external": {
        const origin = navigation.origin;
        return (
          <PassportScreen className="gap-6">
            <div className="space-y-3">
              <DisplayHeading accent="Ring.">Sign in with</DisplayHeading>
              <LeadText>
                Approve this request in Pubky Ring and choose the identity to sign in with there.
                After approving in Pubky Ring, return to the app.
              </LeadText>
            </div>
            <ExternalSignerRequest getAuthorizationUrl={() => controller.externalSignerUrl()} />
            <PassportNavigation
              className="mt-auto md:mt-0"
              back={<BackButton onClick={() => navigate(origin)} />}
              confirm={
                // Passport cannot see Ring's approval; this only hands the person back to the app.
                <Button
                  className="w-full"
                  onClick={() => void controller.finishExternalApproval()}
                  size="lg"
                >
                  <CheckIcon />I approved in Pubky Ring
                </Button>
              }
            />
          </PassportScreen>
        );
      }
      case "manage":
      case "recovery":
      case "ring":
      case "backup-to-google":
      case "detach":
        return (
          <IdentityManagementScreens
            actions={actions}
            catalog={catalog}
            navigation={navigation}
            onEditProfile={(publicKeyZ32) => navigate({ view: "profile", publicKeyZ32 })}
            onHome={goHome}
            onNavigate={navigate}
            onRemoveLocalIdentity={removeIdentity}
          />
        );
      case "home": {
        if (!activeIdentity) return identitySelection;
        if (authorization.status === "review") {
          return (
            <AuthorizationFlow
              authorization={authorization}
              controller={controller}
              identity={activeIdentity}
              onUseRing={() => navigate({ view: "external", origin: { view: "home" } })}
              onSwitch={() => navigate({ view: "switch" })}
            />
          );
        }
        const publicKeyZ32 = activeIdentity.publicIdentity.publicKeyZ32;
        return (
          <IdentityOverview
            key={publicKeyZ32}
            identity={activeIdentity}
            onAuthorize={() => navigate({ view: "manual" })}
            onSwitch={() => navigate({ view: "switch" })}
            onManage={() => navigate({ view: "manage", publicKeyZ32 })}
          />
        );
      }
    }
  }

  return (
    <>
      <SignInBand authorization={authorization} />
      {renderScreen()}
    </>
  );
}
