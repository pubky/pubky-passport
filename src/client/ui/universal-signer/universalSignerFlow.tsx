"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Result } from "better-result";
import { Button } from "@/client/ui/shared/primitives/button";
import { RotateCcwIcon } from "@/client/ui/shared/icons";

import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import { RingProfileEditor } from "@/client/logic/profile/RingProfileEditor";
import type {
  LocalIdentityCatalog,
  LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";
import {
  DeepLinkLauncher,
  ringHandoffMode,
} from "@/client/logic/universal-signer/deepLinkLauncher";
import {
  findIdentity,
  initialSignerNavigation,
  requiresProfileSetup,
  resolveSignerNavigation,
  type SignerNavigation,
} from "@/client/logic/universal-signer/signerNavigation";
import { AuthorizationFlow } from "@/client/ui/authorization/authorizationFlow";
import { ChooseIdentity } from "@/client/ui/authorization/choose/chooseIdentity";
import { OtherWaysIn } from "@/client/ui/authorization/choose/otherWaysIn";
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
import { CancelButton } from "@/client/ui/shared/cancelButton";
import { ErrorScreen } from "@/client/ui/shared/errorScreen";
import { LoadingScreen } from "@/client/ui/shared/loadingScreen";
import { AddIdentity } from "./addIdentity";
import { IdentityManagementScreens } from "./identityManagementScreens";
import { RingSignIn } from "./ringSignIn";
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
        <ErrorScreen
          accent="unavailable."
          action={
            authorization.status === "review" ? undefined : (
              <Button className="w-full" onClick={() => window.location.replace("/")} size="lg">
                <RotateCcwIcon />
                Try again
              </Button>
            )
          }
          back={
            authorization.status === "review" ? (
              <CancelButton onClick={() => void controller.cancel()} />
            ) : undefined
          }
          cause="Passport could not read identities stored in this browser."
          nextStep={
            authorization.status === "review"
              ? "Cancel this request so the app stops waiting, then check that this browser lets Passport store site data."
              : "Try again. If this keeps happening, check that this browser lets Passport store site data."
          }
          title="Storage"
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
  const {
    features: { google },
    homeserver: providerHomeserver,
    httpRelay,
  } = usePassportProvider();
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
  // Follows the request's deep link to Pubky Ring on a phone, and notices when Ring did not open.
  const [ringLauncher] = useState(() => new DeepLinkLauncher(window));
  useEffect(() => () => ringLauncher.dispose(), [ringLauncher]);
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
  const leaveAddition = (back: typeof addBack) =>
    back === "choose" ? navigate({ view: "choose" }) : navigate({ view: "add", back });
  /**
   * Hands the request to Pubky Ring. A phone follows the deep link from this very press, which is
   * what lets the browser open the app; a computer goes straight to the QR code.
   */
  const openRing = (origin: Extract<SignerNavigation, { view: "external" }>["origin"]) => {
    ringLauncher.reset();
    const url = ringHandoffMode(window) === "open" ? controller.externalSignerUrl() : undefined;
    if (url) ringLauncher.launch(url);
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
        // Right after an identity is added, Finish later is the one way to skip: setup stays
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
        if (identity.keySource === "ring" && !ringProfile.isConnected(publicKeyZ32)) {
          return (
            <RingProfileConnection
              controller={ringProfile}
              expectedKey={publicKeyZ32}
              setupRequired={identity.profileSetupRequired === true}
              onBack={onBack}
              onComplete={reopen}
              onDefer={onDefer}
            />
          );
        }
        return (
          <ProfileSetupFlow
            key={publicKeyZ32}
            identity={identity}
            controller={identity.keySource === "ring" ? ringEditor : profiles.controller}
            onBack={onBack}
            onComplete={(profile, avatar) => {
              profiles.published(publicKeyZ32, profile, avatar);
              selectAddedIdentity(publicKeyZ32);
            }}
            onReconnect={identity.keySource === "ring" ? reopen : undefined}
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
            secondaryAction={cancelRequest ? <CancelButton onClick={cancelRequest} /> : null}
            title="Identity"
          />
        );
      }
      case "add":
        if (authorization.status === "review" && addBack === "choose")
          return (
            <OtherWaysIn
              onBack={() => navigate({ view: "choose" })}
              onComplete={completeAddition}
              onImport={() => navigate({ view: "import", back: "choose" })}
              review={authorization.review}
            />
          );
        return (
          <AddIdentity
            forAuthorization={hasRequest}
            onUseRing={hasRequest ? () => openRing({ view: "add", back: addBack }) : undefined}
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
            // Without Google the request's list opens the import itself.
            onBack={() =>
              addBack === "choose" && !google
                ? navigate({ view: "choose" })
                : navigate({ view: "add", back: addBack })
            }
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
            onBack={() => leaveAddition(addBack)}
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
            moreOptionsLabel={
              google ? "Continue with Google or import a backup" : "Import a backup"
            }
            onCancel={() => void controller.cancel()}
            onCreateAccount={() => navigate({ view: "create-account", back: "choose" })}
            onMoreOptions={() =>
              navigate(
                google ? { view: "add", back: "choose" } : { view: "import", back: "choose" },
              )
            }
            onOpenRing={() => openRing({ view: "choose" })}
            onSelect={(publicKeyZ32) => {
              const selected = actions.selectIdentity(publicKeyZ32);
              setSelectionFailed(Result.isError(selected));
              if (Result.isOk(selected)) goHome();
            }}
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
            // Passport cannot see Ring's approval; this only hands the person back to the app.
            onApproved={() => void controller.finishExternalApproval()}
            onBack={() => {
              ringLauncher.reset();
              navigate(origin);
            }}
            review={authorization.review}
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
