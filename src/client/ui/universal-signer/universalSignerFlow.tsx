"use client";

import { type ReactNode, useEffect, useState } from "react";
import { Result } from "better-result";
import { toast } from "sonner";
import { Button } from "@/client/ui/shared/primitives/button";
import { RotateCcwIcon, XIcon } from "@/client/ui/shared/icons";

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
import { ChooseIdentity } from "@/client/ui/authorization/choose/chooseIdentity";
import { ManualAuthorization } from "@/client/ui/authorization/manual-entry/manualAuthorization";
import { RequestClosed } from "@/client/ui/authorization/requestClosed";
import { SignInBand } from "@/client/ui/authorization/signInBand";
import {
  usePassportAuthorization,
  type AuthorizationController,
} from "@/client/ui/authorization/usePassportAuthorization";
import { usePendingRequestGuard } from "@/client/ui/authorization/usePendingRequestGuard";
import {
  useIdentityCatalog,
  type IdentityCatalogActions,
} from "@/client/ui/identity-catalog/useIdentityCatalog";
import { IdentitySelectionFlow } from "@/client/ui/identity-catalog/selection/identitySelectionFlow";
import { IdentityOverview } from "@/client/ui/identity-dashboard/identityOverview";
import { BackupImportFlow } from "@/client/ui/local-account/backupImportFlow";
import { CreateAccountFlow } from "@/client/ui/onboarding/create-account/createAccountFlow";
import { BackButton } from "@/client/ui/shared/backButton";
import { ErrorScreen } from "@/client/ui/shared/errorScreen";
import { LoadingScreen } from "@/client/ui/shared/loadingScreen";
import { ACCOUNT_SETUP_STEPS, SetupProgressProvider } from "@/client/ui/shared/setupProgress";
import { AddIdentity } from "./addIdentity";
import { IdentitiesUnavailable } from "./identitiesUnavailable";
import { IdentityManagementScreens } from "./identityManagementScreens";
import { RingSignIn } from "./ringSignIn";
import { useRingRequestLauncher } from "./useRingRequestLauncher";
import { useIdentityProfiles } from "@/client/ui/profile/useIdentityProfiles";
import { ProfileSetupFlow } from "@/client/ui/profile/profileSetupFlow";
import { RingProfileConnection } from "@/client/ui/profile/ringProfileConnection";
import { usePassportCollaborators } from "@/client/ui/passportCollaborators";
import { usePassportProvider } from "@/client/ui/passportProviderConfiguration";

export function UniversalSignerFlow() {
  const { controller, state: authorization, closed } = usePassportAuthorization();
  const identities = useIdentityCatalog();
  usePendingRequestGuard(controller);

  if (closed) return <RequestClosed />;
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
        <IdentitiesUnavailable
          authorization={authorization}
          code={identities.code}
          controller={controller}
          reason={identities.reason}
        />
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
  const { createRingProfileController, readAccountDraft } = usePassportCollaborators();
  const hasRequest = authorization.status === "review";
  // Navigation reads only which identities are saved, so the stored catalog serves it.
  const context = { catalog: storedCatalog, requestPending: hasRequest };
  const [storedNavigation, navigate] = useState<SignerNavigation>(() => {
    const draft = readAccountDraft();
    return initialSignerNavigation(context, Result.isOk(draft) ? draft.value : null);
  });
  const navigation = resolveSignerNavigation(storedNavigation, context);
  // The resolved screen is kept, so a setup screen stays open while its own completion changes
  // the catalog (profile setup clears its flag before it reports back).
  if (navigation !== storedNavigation) navigate(navigation);
  // With a request nothing is read until an identity is chosen: its list shows the summaries kept
  // from earlier reads, and only the chosen identity's profile is read, for its review.
  const profiles = useIdentityProfiles(storedCatalog, {
    loadActive: !hasRequest || navigation.view === "home",
  });
  const { homeserver: providerHomeserver, httpRelay } = usePassportProvider();
  const [ringProfile] = useState(() => createRingProfileController(httpRelay));
  useEffect(() => {
    const dispose = () => ringProfile.dispose();
    window.addEventListener("pagehide", dispose);
    return () => {
      window.removeEventListener("pagehide", dispose);
      dispose();
    };
  }, [ringProfile]);
  // State, not a memo: it keeps unpublished profile edits while Ring reconnects.
  const [ringEditor] = useState(() => new RingProfileEditor(profiles.controller, ringProfile));
  // Kept edits last while their identity's editor, or its Ring connection, is open; leaving it
  // any way (a discarded Back or Skip for now, a save, a removed identity) drops them.
  const editingKey = navigation.view === "profile" ? navigation.publicKeyZ32 : undefined;
  useEffect(() => ringEditor.forgetEditsExcept(editingKey), [ringEditor, editingKey]);
  // Follows the request's deep link to Pubky Ring on a phone, and notices when Ring did not open.
  const [ringLauncher, launchRing] = useRingRequestLauncher(controller);
  const [selectionFailed, setSelectionFailed] = useState(false);
  const catalog = profiles.catalog;
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
  // Account creation and import open from the start page, and Back returns there.
  const backToStart = () => navigate({ view: "add", back: addBack });
  /**
   * Hands the request to Pubky Ring. A phone follows the deep link from this very press, which is
   * what lets the browser open the app; a computer goes straight to the QR code.
   */
  const openRing = (origin: Extract<SignerNavigation, { view: "external" }>["origin"]) => {
    launchRing();
    navigate({ view: "external", origin });
  };
  const selectAddedIdentity = (publicKeyZ32: string) => {
    const selected = actions.selectIdentity(publicKeyZ32);
    navigate(Result.isOk(selected) ? { view: "home" } : { view: "finish-add", publicKeyZ32 });
  };
  const completeAddition = (identity: LocalIdentityMetadata) => {
    const publicKeyZ32 = identity.publicIdentity.publicKeyZ32;
    if (requiresProfileSetup(identity, catalog)) {
      actions.selectIdentity(publicKeyZ32);
      navigate({ view: "profile", publicKeyZ32, from: "addition" });
    } else selectAddedIdentity(publicKeyZ32);
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
        const { from, publicKeyZ32 } = navigation;
        const identity = findIdentity(catalog, publicKeyZ32);
        if (!identity) return null;
        // Right after an identity is added, Skip for now is the one way to skip: setup stays
        // required, so the overview and Manage keep offering it, and a request goes on to its
        // review. Opened from the overview or Manage, Back returns there.
        const onDefer = from === "addition" ? goHome : undefined;
        const onBack =
          from === "addition"
            ? undefined
            : from === "manage"
              ? () => navigate({ view: "manage", publicKeyZ32 })
              : goHome;
        const reopen = () => navigate({ view: "profile", publicKeyZ32, from });
        const keptEdits =
          identity.keySource === "ring" ? ringEditor.keptEdits(publicKeyZ32) : undefined;
        if (identity.keySource === "ring" && !ringProfile.isConnected(publicKeyZ32)) {
          const setupRequired = identity.profileSetupRequired === true;
          const connection = (
            <RingProfileConnection
              controller={ringProfile}
              identity={identity}
              setupRequired={setupRequired}
              unsavedEdits={keptEdits !== undefined}
              onBack={onBack}
              onComplete={reopen}
              onDefer={onDefer}
            />
          );
          // Unfinished setup shows the same last step as the profile form this connection opens.
          return setupRequired ? (
            <SetupProgressProvider steps={ACCOUNT_SETUP_STEPS} current={2}>
              {connection}
            </SetupProgressProvider>
          ) : (
            connection
          );
        }
        return (
          <ProfileSetupFlow
            key={publicKeyZ32}
            // A key made in this browser was just registered; Google and Ring each said so already.
            created={
              from === "addition" && identity.keySource !== "ring" && !identity.googleAccount
            }
            forRequest={hasRequest}
            identity={identity}
            controller={identity.keySource === "ring" ? ringEditor : profiles.controller}
            keptEdits={keptEdits}
            onBack={onBack}
            onComplete={(profile, avatar) => {
              profiles.published(publicKeyZ32, profile, avatar);
              toast.success("Profile published");
              // Saving returns to where the editor was opened, like its Back.
              if (from === "manage") navigate({ view: "manage", publicKeyZ32 });
              else selectAddedIdentity(publicKeyZ32);
            }}
            // The grant ended before a save: Ring connects again and the edits come back with it.
            onReconnect={
              identity.keySource === "ring"
                ? (edits) => {
                    ringEditor.keepEdits(publicKeyZ32, edits);
                    reopen();
                  }
                : undefined
            }
            onDefer={onDefer}
          />
        );
      }
      case "finish-add": {
        const publicKeyZ32 = navigation.publicKeyZ32;
        return (
          <ErrorScreen
            accent="saved."
            action={
              <Button
                className="w-full"
                onClick={() => selectAddedIdentity(publicKeyZ32)}
                size="lg"
              >
                <RotateCcwIcon />
                Select identity
              </Button>
            }
            back={<BackButton onClick={goHome} />}
            cause="Passport saved your identity but could not select it."
            nextStep="Try again to continue."
            secondaryAction={
              // Answering the app is a side action here, a text action like every other one.
              cancelRequest ? (
                <Button onClick={cancelRequest} variant="link">
                  <XIcon />
                  Cancel
                </Button>
              ) : null
            }
            title="Identity"
          />
        );
      }
      case "add":
        // During a request this is its first step when nothing is saved (Cancel answers the app,
        // with Back to the list once an identity arrives), or Use another identity from the list.
        return (
          <AddIdentity
            request={authorization.status === "review" ? authorization.review : undefined}
            onUseRing={hasRequest ? () => openRing({ view: "add", back: addBack }) : undefined}
            onConnectRing={
              hasRequest ? undefined : () => navigate({ view: "connect-ring", back: addBack })
            }
            onBack={
              addBack
                ? () => navigate({ view: addBack })
                : // An identity saved elsewhere (another tab, say) while this is the request's
                  // first step leaves a list to go back to.
                  hasRequest && catalog.identities.length > 0
                  ? () => navigate({ view: "choose" })
                  : undefined
            }
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
            onBack={backToStart}
            onComplete={(identity) => {
              // The next screen is the overview or the app's review, which do not say it worked.
              toast.success("Recovery file imported", {
                description: "Your pubky is now saved in this browser.",
              });
              completeAddition(identity);
            }}
            onSelectExisting={selectAddedIdentity}
          />
        );
      case "connect-ring":
        // Adds an existing Ring identity; without setup required its profile stays as it is.
        return (
          <RingProfileConnection
            controller={ringProfile}
            onBack={backToStart}
            onComplete={completeAddition}
          />
        );
      case "create-account":
        return (
          <CreateAccountFlow
            ringProfileController={ringProfile}
            inviteHomeserver={providerHomeserver ?? ""}
            onBack={backToStart}
            onLocalComplete={completeAddition}
          />
        );
      case "switch":
        return identitySelection;
      case "choose":
        if (authorization.status !== "review") return null;
        return (
          <ChooseIdentity
            activePublicKeyZ32={catalog.activePublicKeyZ32}
            identities={catalog.identities}
            onCancel={() => void controller.cancel()}
            onOpenRing={() => openRing({ view: "choose" })}
            onSelect={(publicKeyZ32) => {
              const selected = actions.selectIdentity(publicKeyZ32);
              setSelectionFailed(Result.isError(selected));
              if (Result.isOk(selected)) goHome();
            }}
            onUseAnotherIdentity={() => navigate({ view: "add", back: "choose" })}
            review={authorization.review}
            selectionFailed={selectionFailed}
          />
        );
      case "manual":
        return <ManualAuthorization onBack={goHome} />;
      case "external": {
        if (authorization.status !== "review") return null;
        const origin = navigation.origin;
        return (
          <RingSignIn
            getAuthorizationUrl={() => controller.externalSignerUrl()}
            launcher={ringLauncher}
            // Both only hand the person back to the app, which finishes the sign-in itself.
            onApproved={() => void controller.finishExternalApproval()}
            onBack={() => {
              ringLauncher.reset();
              navigate(origin);
            }}
            review={authorization.review}
            watchApproval={
              controller.canWatchExternalApproval()
                ? () => controller.watchExternalApproval()
                : undefined
            }
          />
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
            onEditProfile={(publicKeyZ32) =>
              navigate({ view: "profile", publicKeyZ32, from: "manage" })
            }
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
              onUseRing={() => openRing({ view: "home" })}
              onSwitch={() => navigate({ view: "choose" })}
            />
          );
        }
        const publicKeyZ32 = activeIdentity.publicIdentity.publicKeyZ32;
        return (
          <IdentityOverview
            key={publicKeyZ32}
            identity={activeIdentity}
            onAuthorize={() => navigate({ view: "manual" })}
            onBackup={(check) =>
              navigate({
                view: "recovery",
                publicKeyZ32,
                home: true,
                ...(check ? { check: true as const } : {}),
              })
            }
            onSetUpProfile={() => navigate({ view: "profile", publicKeyZ32, from: "overview" })}
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
