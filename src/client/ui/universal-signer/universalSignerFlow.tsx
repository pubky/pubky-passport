"use client";

import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";
import { Result } from "better-result";
import { toast } from "sonner";
import { Button } from "@/client/ui/shared/primitives/button";
import { RotateCcwIcon, XIcon } from "@/client/ui/shared/icons";

import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import { RingProfileEditor } from "@/client/logic/profile/RingProfileEditor";
import { markAuthorizeFromIdentity } from "@/client/logic/universal-signer/authorizeFromIdentity";
import type {
  LocalIdentityCatalog,
  LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";
import {
  findIdentity,
  initialSignerNavigation,
  requiresProfileSetup,
  resolveSignerNavigation,
  signingIdentities,
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
import { goToPassport } from "@/client/ui/authorization/requestExit";
import { useAuthorizationRequester } from "@/client/ui/authorization/useAuthorizationRequester";
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
import { Notice } from "@/client/ui/shared/notice";
import { LoadingScreen } from "@/client/ui/shared/loadingScreen";
import { OutcomeScreen } from "@/client/ui/shared/outcomeScreen";
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
    authorization.status !== "manual-entry" &&
    authorization.status !== "handed-off"
  ) {
    // Outcomes and approvals in progress stay visible without the catalog; none can switch.
    // A request handed to Pubky Ring ends on Passport's home, which needs the catalog.
    return (
      <>
        <SignInBand authorization={authorization} />
        <AuthorizationFlow authorization={authorization} controller={controller} />
      </>
    );
  }
  if (identities.status === "loading") {
    return <LoadingScreen label="Loading Passport" />;
  }
  if (identities.status === "unavailable") {
    return (
      <>
        {authorization.status === "handed-off" ? null : (
          <SignInBand authorization={authorization} />
        )}
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

/**
 * The page Google returned to never lists identities or reviews the request: once the sign-in is
 * done, it returns to the page the request entered at, which opens on the identity just set up.
 */
function ReturnToAuthorization({
  identityPublicKeyZ32,
  onLeave,
}: {
  identityPublicKeyZ32?: string | undefined;
  onLeave: () => void;
}) {
  const leave = useEffectEvent(onLeave);
  useEffect(() => {
    if (identityPublicKeyZ32 !== undefined) markAuthorizeFromIdentity(identityPublicKeyZ32);
    leave();
  }, [identityPublicKeyZ32]);
  return <LoadingScreen label="Returning to the sign-in" />;
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
  const {
    createRingProfileController,
    googleRedirect,
    readAccountDraft,
    takeAuthorizeFromIdentity,
  } = usePassportCollaborators();
  const hasRequest = authorization.status === "review";
  // Navigation reads only which identities are saved, so the stored catalog serves it.
  const context = { catalog: storedCatalog, requestPending: hasRequest };
  // Google returned to this page for a request's sign-in (it always returns to the origin root).
  // The page finishes that sign-in and nothing else: the request is reviewed where it entered.
  const [googleReturn] = useState(() => googleRedirect.isReturn());
  const leaveGoogleReturn = () => {
    // A request that is gone has nowhere to return to; Passport's own home is what is left.
    if (!googleRedirect.returnToAuthorization()) goToPassport();
  };
  const [storedNavigation, navigate] = useState<SignerNavigation>(() => {
    // The start page holds the Google sign-in, which goes on by itself there.
    if (googleRedirect.isReturn()) return { view: "add", back: null };
    const draft = readAccountDraft();
    return initialSignerNavigation(
      context,
      Result.isOk(draft) ? draft.value : null,
      takeAuthorizeFromIdentity(),
    );
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
    // Best effort on page leave: the revocation this starts is dropped when the page unloads, so
    // the grant stays valid on the homeserver (by design: the grant lasts for the page session).
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
  // An app holds a Session and waits for this key's profile: after a Pubky Ring sign-in it said
  // so on this request's channel, or it reopened Passport on `/#profile=<key>`.
  const appProfileKey = controller.profileNeeded();
  // Opened once per key, like the resolved navigation above: derived during render.
  const [appProfileOpened, setAppProfileOpened] = useState<string>();
  if (appProfileKey !== undefined && appProfileOpened !== appProfileKey) {
    setAppProfileOpened(appProfileKey);
    navigate({ view: "profile", publicKeyZ32: appProfileKey, from: "app" });
  }
  // An app linked to an identity's profile editor (`/#edit-profile=<key>`): opened once.
  const editEntry = controller.editProfileEntry();
  const [editOpened, setEditOpened] = useState(false);
  if (editEntry !== undefined && !editOpened) {
    setEditOpened(true);
    navigate(
      editEntry.status === "edit"
        ? { view: "profile", publicKeyZ32: editEntry.publicKeyZ32, from: "edit" }
        : { view: "edit-invalid" },
    );
  }
  // Ring's answer reached the app and there is no app page to return to: Passport goes on to its
  // own home, in this document, where a bound app can still ask for the profile (above).
  const [wentHome, setWentHome] = useState(false);
  if (authorization.status === "handed-off" && !wentHome) {
    setWentHome(true);
    if (appProfileKey === undefined) navigate({ view: "home" });
  }
  const remembered = useRef<string>(undefined);
  useEffect(() => {
    // From this request's own Ring sign-in, Passport keeps the identity with its profile still to
    // do, so home offers it after the window closes (once per key; an identity it already has is
    // left as it is). A `/#profile=` link alone saves nothing: Passport's Ring grant for the key
    // saves it once Ring approves.
    if (appProfileKey === undefined || remembered.current === appProfileKey) return;
    remembered.current = appProfileKey;
    if (authorization.status !== "manual-entry") actions.rememberProfileNeeded(appProfileKey);
  }, [appProfileKey, authorization.status, actions]);
  // The app as the sign-in band names it; a page reopened on `/#profile=` has no request to name.
  const { requester: appRequester } = useAuthorizationRequester(
    "review" in authorization ? authorization.review : undefined,
  );
  const appProfileView =
    appProfileKey !== undefined &&
    ((navigation.view === "profile" && navigation.from === "app") ||
      navigation.view === "profile-done");
  // The app asked for an identity with a profile: the chosen one gets one before the review.
  const profileRequired =
    authorization.status === "review" && authorization.profileRequired === true;
  const activeKey = activeIdentity?.publicIdentity.publicKeyZ32;
  const activeRead = activeKey ? profiles.readStatus(activeKey) : undefined;
  if (
    profileRequired &&
    navigation.view === "home" &&
    activeKey &&
    (activeRead === "missing" || activeRead === "unreadable")
  )
    navigate({ view: "profile", publicKeyZ32: activeKey, from: "request" });
  const goHome = () => navigate({ view: "home" });
  /**
   * What the review offers beside Authorize and Cancel: the list where there is another identity
   * to pick, and the same "or" as the list (the start page, whose Back returns to the review, and
   * Pubky Ring).
   */
  const reviewActions = {
    onSwitch:
      signingIdentities(catalog).length > 1 ? () => navigate({ view: "choose" }) : undefined,
    onUseAnotherIdentity: () => navigate({ view: "add", back: "home" }),
    onUseRing: () => openRing({ view: "home" }),
  };
  const addBack = "back" in navigation ? navigation.back : null;
  // Account creation and import open from the start page, and Back returns there.
  const backToStart = () => navigate({ view: "add", back: addBack });
  /**
   * Hands the request to Pubky Ring. A phone follows the deep link from this very press, which is
   * what lets the browser open the app; a computer goes straight to the QR code.
   */
  const openRing = (origin: Extract<SignerNavigation, { view: "external" }>["origin"]) => {
    // PS-6: an explicit Ring action tells a verified opener that the approval moves to Ring.
    controller.reportPhase("ring");
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
    // Once approval begins, no navigation or external handoff can compete with it, except the
    // profile an app asks for after its Pubky Ring sign-in.
    if (
      authorization.status !== "review" &&
      authorization.status !== "manual-entry" &&
      authorization.status !== "handed-off" &&
      !appProfileView
    ) {
      return (
        <AuthorizationFlow
          authorization={authorization}
          controller={controller}
          identity={activeIdentity}
          // The review stays as it was while its answer is on the way, with these disabled.
          {...reviewActions}
        />
      );
    }
    switch (navigation.view) {
      case "profile": {
        const { from, publicKeyZ32 } = navigation;
        const forApp = from === "app";
        // An app's edit link: only this key's profile, and only if Passport holds the key or Ring
        // approves exactly this one.
        const forEditLink = from === "edit";
        const saved = findIdentity(catalog, publicKeyZ32);
        // A key not saved yet (a `/#profile=` or `/#edit-profile=` link) is connected through
        // Ring, which saves it once it approves this very key.
        const identity =
          saved ??
          (forApp || forEditLink
            ? ({
                publicIdentity: { publicKeyZ32 },
                keySource: "ring",
                ...(forApp ? { profileSetupRequired: true as const } : {}),
              } satisfies LocalIdentityMetadata)
            : undefined);
        if (!identity) return null;
        // Right after an identity is added, Skip for now is the one way to skip: setup stays
        // required, so the overview and Manage keep offering it, and a request goes on to its
        // review. Opened from the overview or Manage (a browser key's), Back returns there. An app that needs a
        // profile gets no skip: Back returns to the identity list, where Cancel answers it.
        const onDefer = from === "addition" && !profileRequired ? goHome : undefined;
        // For an app's Session nothing leads away, except home from a page a link opened: closing
        // the window leaves the profile for later either way.
        const onBack = forApp
          ? authorization.status === "manual-entry"
            ? goHome
            : undefined
          : forEditLink
            ? goHome
            : from === "request" || (from === "addition" && profileRequired)
              ? () => navigate({ view: "choose" })
              : from === "addition"
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
              // The person just signed in to the app with Ring, and is asked to approve again.
              appSignIn={forApp ? { requester: appRequester } : undefined}
              controller={ringProfile}
              identity={identity}
              notice={
                forEditLink && !saved ? (
                  <Notice tone="info">
                    This pubky is not saved in this Passport. If its key is in Pubky Ring, approve
                    there to edit its profile. Passport edits no other identity.
                  </Notice>
                ) : undefined
              }
              setupRequired={setupRequired}
              unsavedEdits={keptEdits !== undefined}
              onBack={onBack}
              onComplete={reopen}
              onDefer={onDefer}
            />
          );
          // Unfinished setup shows the same last step as the profile form this connection opens.
          return setupRequired && !forApp ? (
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
            requiredByRequest={profileRequired || forApp}
            withoutSetupSteps={forApp || forEditLink}
            identity={identity}
            controller={identity.keySource === "ring" ? ringEditor : profiles.controller}
            keptEdits={keptEdits}
            onBack={onBack}
            onComplete={(profile, avatar) => {
              profiles.published(publicKeyZ32, profile, avatar);
              toast.success("Profile published");
              // The waiting app hears of it (`profile-ready`) and reads the profile itself.
              if (forApp) {
                navigate({ view: "profile-done", told: controller.profileReady() });
              }
              // The app whose link opened the editor hears of it, if it opened this window.
              else if (forEditLink) {
                navigate({ view: "profile-updated", told: controller.profileUpdated() });
              }
              // Saving returns to where the editor was opened, like its Back.
              else if (from === "manage") navigate({ view: "manage", publicKeyZ32 });
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
      case "profile-done":
        return (
          <OutcomeScreen
            accent="published."
            action={
              // The app closes this window when it signs in; this is for when it does not. A
              // window no script opened cannot close itself and goes home instead.
              <Button
                className="w-full"
                onClick={() => {
                  window.close();
                  if (!window.closed) goToPassport();
                }}
                size="lg"
              >
                <XIcon />
                {navigation.told ? "Close window" : "Done"}
              </Button>
            }
            description={
              navigation.told
                ? "Return to the app: it finishes signing you in with your profile."
                : "Return to the app and sign in again there: it will find your profile."
            }
            title="Profile"
          />
        );
      case "profile-updated":
        return (
          <OutcomeScreen
            accent="updated."
            action={
              // A window a link opened in a tab of its own may close itself; otherwise home.
              <Button
                className="w-full"
                onClick={() => {
                  window.close();
                  if (!window.closed) goHome();
                }}
                size="lg"
              >
                <XIcon />
                Close window
              </Button>
            }
            description={
              navigation.told
                ? "The app that opened Passport knows: it shows your new profile."
                : "Return to the app: it shows your new profile once it reads it again."
            }
            title="Profile"
          />
        );
      case "edit-invalid":
        return (
          <ErrorScreen
            accent="link."
            action={
              <Button className="w-full" onClick={goHome} size="lg">
                Go to Passport
              </Button>
            }
            cause="This link can't be used to edit a profile."
            nextStep="Go back to the app and open its Edit profile link again."
            title="Invalid profile"
          />
        );
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
            googleReturn={googleReturn && hasRequest ? { onLeave: leaveGoogleReturn } : undefined}
            request={authorization.status === "review" ? authorization.review : undefined}
            onUseRing={hasRequest ? () => openRing({ view: "add", back: addBack }) : undefined}
            // Adds an existing Ring identity; without setup required its profile stays as it is.
            ringConnection={
              hasRequest
                ? undefined
                : // `close` is Cancel on a phone; a computer's card has nothing to cancel.
                  (close) => (
                    <RingProfileConnection
                      controller={ringProfile}
                      embedded
                      onBack={close}
                      // On a phone the card's own press started this: Ring opens when it can.
                      openOnReady={close !== undefined}
                      onComplete={completeAddition}
                    />
                  )
            }
            onBack={
              addBack
                ? () => navigate({ view: addBack })
                : // An identity saved elsewhere (another tab, say) while this is the request's
                  // first step leaves a list to go back to, if Passport can sign with it.
                  hasRequest && signingIdentities(catalog).length > 0
                  ? () => navigate({ view: "choose" })
                  : undefined
            }
            onCancel={addBack ? undefined : cancelRequest}
            onComplete={completeAddition}
            onCreateAccount={(method) =>
              navigate({ view: "create-account", back: addBack, method })
            }
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
      case "create-account":
        return (
          <CreateAccountFlow
            ringProfileController={ringProfile}
            inviteHomeserver={providerHomeserver ?? ""}
            method={navigation.method}
            onBack={backToStart}
            onLocalComplete={completeAddition}
          />
        );
      case "switch":
        return identitySelection;
      case "choose":
        if (authorization.status !== "review") return null;
        if (googleReturn) return <ReturnToAuthorization onLeave={leaveGoogleReturn} />;
        return (
          <ChooseIdentity
            activePublicKeyZ32={catalog.activePublicKeyZ32}
            identities={signingIdentities(catalog)}
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
        return (
          <ManualAuthorization
            identityPublicKeyZ32={activeIdentity?.publicIdentity.publicKeyZ32}
            onBack={goHome}
          />
        );
      case "external": {
        if (authorization.status !== "review") return null;
        const origin = navigation.origin;
        return (
          <RingSignIn
            getAuthorizationUrl={() => controller.externalSignerUrl()}
            launcher={ringLauncher}
            onBack={() => {
              controller.leaveExternalSigner();
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
      case "verify":
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
        if (authorization.status === "review" && googleReturn) {
          // The identity Google just set up is the one to review: its page opens on it.
          return (
            <ReturnToAuthorization
              identityPublicKeyZ32={activeIdentity.publicIdentity.publicKeyZ32}
              onLeave={leaveGoogleReturn}
            />
          );
        }
        if (authorization.status === "review") {
          // A missing profile already moved on to its form above; this waits for the read.
          if (profileRequired && activeRead !== "found") {
            if (activeRead === "failed")
              return (
                <ErrorScreen
                  accent="profile."
                  action={
                    <Button
                      className="w-full"
                      onClick={() => profiles.retry(activeIdentity.publicIdentity.publicKeyZ32)}
                      size="lg"
                    >
                      <RotateCcwIcon />
                      Try again
                    </Button>
                  }
                  back={<BackButton onClick={() => navigate({ view: "choose" })} />}
                  cause="This app needs a public profile, and Passport could not read this identity's profile."
                  nextStep="Check your connection and try again."
                  title="Couldn’t read your"
                />
              );
            return <LoadingScreen label="Checking your profile" />;
          }
          return (
            <AuthorizationFlow
              authorization={authorization}
              controller={controller}
              identity={activeIdentity}
              {...reviewActions}
            />
          );
        }
        const publicKeyZ32 = activeIdentity.publicIdentity.publicKeyZ32;
        return (
          <IdentityOverview
            key={publicKeyZ32}
            identity={activeIdentity}
            onAuthorize={() => navigate({ view: "manual" })}
            onBackup={() => navigate({ view: "recovery", publicKeyZ32, home: true })}
            onVerifyBackup={() => navigate({ view: "verify", publicKeyZ32, from: "home" })}
            onEditProfile={() => navigate({ view: "profile", publicKeyZ32, from: "overview" })}
            onSwitch={() => navigate({ view: "switch" })}
            onManage={() => navigate({ view: "manage", publicKeyZ32 })}
            onRemoveIdentity={() => removeIdentity(publicKeyZ32)}
            onRemoved={goHome}
          />
        );
      }
    }
  }

  return (
    <>
      {/* After a hand-off, only the profile the app asked for still belongs to its sign-in. */}
      {authorization.status !== "handed-off" || appProfileView ? (
        <SignInBand authorization={authorization} />
      ) : null}
      {renderScreen()}
    </>
  );
}
