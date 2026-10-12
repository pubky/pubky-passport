"use client";

import Image from "next/image";
import { Result } from "better-result";
import { useState } from "react";
import { preload } from "react-dom";

import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import type {
  LocalIdentityCatalog,
  LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";
import { IdentityManagement } from "@/client/ui/identity-dashboard/management/identityManagement";
import { DetachFromGoogleFlow } from "@/client/ui/identity-dashboard/management/detach-from-google/detachFromGoogleFlow";
import { RecoveryFileDownload } from "@/client/ui/identity-dashboard/management/recovery-file/recoveryFileDownload";
import { MigrateToPubkyRing } from "@/client/ui/identity-dashboard/management/migrate-to-pubky-ring/migrateToPubkyRing";
import { IdentitySelectionFlow } from "@/client/ui/identity-catalog/selection/identitySelectionFlow";
import {
  useIdentityCatalog,
  type IdentityCatalogActions,
} from "@/client/ui/identity-catalog/useIdentityCatalog";
import { IdentityEstablishmentFlow } from "@/client/ui/onboarding/identityEstablishmentFlow";
import { ArrowRightIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { LoadingScreen } from "@/client/ui/shared/loadingScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { usePassportCollaborators } from "@/client/ui/passportCollaborators";
import { SignInBand } from "./signInBand";
import { AuthorizationReview } from "./review/authorizationReview";
import { InvalidAuthorization } from "./invalidAuthorization";
import { ManualAuthorization } from "./manual-entry/manualAuthorization";
import { usePassportAuthorization, type AuthorizationController } from "./usePassportAuthorization";
import {
  isGoogleRedirectReturn,
  returnToAuthorization,
} from "@/client/logic/google-identity/gia/googleRedirectBootstrap";

const AUTHORIZATION_LOADING_HEIGHT =
  "min-h-[calc(100svh-var(--passport-header-height)-var(--passport-context-band-height))]";

function AuthorizationFlow() {
  const { controller: passportAuthorizationController, state: authorization } =
    usePassportAuthorization();

  if (!passportAuthorizationController || !authorization) {
    return <LoadingScreen className={AUTHORIZATION_LOADING_HEIGHT} label="Loading authorization" />;
  }

  if (authorization.status === "completing") {
    preload("/illustrations/checkmark.png", { as: "image" });
  }

  switch (authorization.status) {
    case "manual-entry":
      return <ManualAuthorization onBack={goHome} />;
    case "invalid":
      return <InvalidAuthorization onBack={goHome} />;
    case "failed":
      return (
        <PassportScreen className="gap-6">
          <DisplayHeading accent="failed." aria-label="Authorization failed.">
            Authorization
          </DisplayHeading>
          <LeadText>Passport could not authorize this request with the selected identity.</LeadText>
          <PassportNavigation back={<BackButton onClick={goHome} />} />
        </PassportScreen>
      );
    case "approved":
      return <AuthorizationTerminal outcome="approved" />;
    case "cancelled":
      return <AuthorizationTerminal outcome="cancelled" />;
    case "review":
    case "preparing":
    case "granting":
    case "completing":
      return (
        <>
          {authorization.review.callbackHost ? (
            <SignInBand requester={authorization.review.callbackHost} />
          ) : null}
          <AuthorizationWithIdentity
            authorization={authorization}
            passportAuthorizationController={passportAuthorizationController}
          />
        </>
      );
  }
}

type ActiveAuthorization = Extract<
  PassportAuthorizationViewState,
  { status: "review" | "preparing" | "granting" | "completing" }
>;

/** `first-identity-setup` stays until the setup screen reports completion, not when the catalog fills. */
type AuthorizationIdentityView =
  | { view: "first-identity-setup" | "review" | "identity-selection" }
  | { view: "manage-identity" | "recovery-file" | "migrate-to-pubky-ring"; publicKeyZ32: string }
  | { view: "detach-from-google"; googleSubject: string; identity: LocalIdentityMetadata };

function AuthorizationWithIdentity({
  authorization,
  passportAuthorizationController,
}: {
  authorization: ActiveAuthorization;
  passportAuthorizationController: AuthorizationController;
}) {
  const identityCatalog = useIdentityCatalog();

  switch (identityCatalog.status) {
    case "loading":
      return <LoadingScreen className={AUTHORIZATION_LOADING_HEIGHT} label="Loading identities" />;
    case "unavailable":
      return (
        <PassportScreen className="gap-6">
          <DisplayHeading accent="unavailable." aria-label="Identities unavailable.">
            Identities
          </DisplayHeading>
          <LeadText>Passport could not read identities stored on this device.</LeadText>
          <PassportNavigation
            back={
              <BackButton
                onClick={() => {
                  void passportAuthorizationController.cancel();
                }}
              />
            }
          />
        </PassportScreen>
      );
    case "ready":
      return (
        <ReadyAuthorizationWithIdentity
          actions={identityCatalog.actions}
          authorization={authorization}
          catalog={identityCatalog.catalog}
          passportAuthorizationController={passportAuthorizationController}
        />
      );
  }
}

function ReadyAuthorizationWithIdentity({
  actions,
  authorization,
  catalog,
  passportAuthorizationController,
}: {
  actions: IdentityCatalogActions;
  authorization: ActiveAuthorization;
  catalog: LocalIdentityCatalog;
  passportAuthorizationController: AuthorizationController;
}) {
  const { IdentitySetup } = usePassportCollaborators();
  const Setup = IdentitySetup ?? IdentityEstablishmentFlow;
  const [navigation, setNavigation] = useState<AuthorizationIdentityView>(() => ({
    view:
      catalog.identities.length === 0 || isGoogleRedirectReturn()
        ? "first-identity-setup"
        : "review",
  }));
  // Consent belongs to the pending request, including while switching or managing identities.
  const [declinedEncryptionPaths, setDeclinedEncryptionPaths] = useState<readonly string[]>([]);
  const state = resolveAuthorizationIdentityView(navigation, catalog);

  if (state.view === "first-identity-setup") {
    return (
      <Setup
        forAuthorization
        onBack={() => {
          void passportAuthorizationController.cancel();
        }}
        onComplete={() => {
          // The root callback has a narrower CSP; grant approval belongs on /authorize.
          if (isGoogleRedirectReturn()) returnToAuthorization();
          else setNavigation({ view: "review" });
        }}
      />
    );
  }

  if (state.view === "identity-selection") {
    return (
      <IdentitySelectionFlow
        catalog={catalog}
        forAuthorization
        onBack={() => setNavigation({ view: "review" })}
        onIdentitySelected={() => setNavigation({ view: "review" })}
        selectIdentity={actions.selectIdentity}
      />
    );
  }

  if (state.view === "manage-identity") {
    const identity = catalog.identities.find(
      (candidate) => candidate.publicIdentity.publicKeyZ32 === state.publicKeyZ32,
    );
    if (!identity) return null;
    const publicKeyZ32 = identity.publicIdentity.publicKeyZ32;
    return (
      <IdentityManagement
        identity={identity}
        onBack={() =>
          setNavigation((current) =>
            current.view === "identity-selection" ? current : { view: "review" },
          )
        }
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
          const removed = actions.removeIdentity(publicKeyZ32);
          if (Result.isOk(removed)) setNavigation({ view: "identity-selection" });
          return removed;
        }}
        onMigrateToKeychain={() => setNavigation({ view: "migrate-to-pubky-ring", publicKeyZ32 })}
        republishHomeserver={() => actions.republishHomeserver(publicKeyZ32)}
        resolveHomeserver={actions.resolveHomeserver}
      />
    );
  }

  if (state.view === "recovery-file") {
    return (
      <RecoveryFileDownload
        createRecoveryFile={actions.createRecoveryFile}
        publicKeyZ32={state.publicKeyZ32}
        onBack={() => setNavigation({ view: "manage-identity", publicKeyZ32: state.publicKeyZ32 })}
      />
    );
  }

  if (state.view === "migrate-to-pubky-ring") {
    return (
      <MigrateToPubkyRing
        createMigration={() => actions.createMigration(state.publicKeyZ32)}
        navigationAction="back"
        onBack={() => setNavigation({ view: "manage-identity", publicKeyZ32: state.publicKeyZ32 })}
      />
    );
  }

  if (state.view === "detach-from-google") {
    return (
      <DetachFromGoogleFlow
        createRecoveryFile={actions.createRecoveryFile}
        createMigration={() => actions.createMigration(state.identity.publicIdentity.publicKeyZ32)}
        googleSubject={state.googleSubject}
        identity={state.identity}
        onBack={() =>
          setNavigation({
            view: "manage-identity",
            publicKeyZ32: state.identity.publicIdentity.publicKeyZ32,
          })
        }
        onDone={() => setNavigation({ view: "identity-selection" })}
      />
    );
  }

  const activeIdentity = catalog.identities.find(
    (identity) => identity.publicIdentity.publicKeyZ32 === catalog.activePublicKeyZ32,
  );
  return (
    <AuthorizationReview
      encryptionConsent={{
        declinedPaths: declinedEncryptionPaths,
        onChange: setDeclinedEncryptionPaths,
      }}
      identity={activeIdentity}
      onAuthorize={(declinedEncryptionPaths) => {
        if (activeIdentity) {
          if (declinedEncryptionPaths.length > 0) {
            void passportAuthorizationController.approve(
              activeIdentity.publicIdentity.publicKeyZ32,
              declinedEncryptionPaths,
            );
          } else {
            void passportAuthorizationController.approve(
              activeIdentity.publicIdentity.publicKeyZ32,
            );
          }
        }
      }}
      onCancel={() => {
        void passportAuthorizationController.cancel();
      }}
      onManage={() => {
        if (activeIdentity) {
          setNavigation({
            view: "manage-identity",
            publicKeyZ32: activeIdentity.publicIdentity.publicKeyZ32,
          });
        }
      }}
      onSwitch={() => setNavigation({ view: "identity-selection" })}
      phase={authorization.status}
      review={authorization.review}
    />
  );
}

function resolveAuthorizationIdentityView(
  navigation: AuthorizationIdentityView,
  catalog: LocalIdentityCatalog,
): AuthorizationIdentityView {
  // Detachment retains its pinned identity until its own completion screen is dismissed.
  if (navigation.view === "detach-from-google") return navigation;
  if (catalog.identities.length === 0) return { view: "first-identity-setup" };
  if (
    "publicKeyZ32" in navigation &&
    !catalog.identities.some(
      (identity) => identity.publicIdentity.publicKeyZ32 === navigation.publicKeyZ32,
    )
  ) {
    return { view: "identity-selection" };
  }
  return navigation;
}

function AuthorizationTerminal({ outcome }: { outcome: "approved" | "cancelled" }) {
  const approved = outcome === "approved";
  return (
    <PassportScreen className="gap-6">
      <DisplayHeading
        accent={approved ? "complete." : "cancelled."}
        aria-label={approved ? "Authorization complete." : "Authorization cancelled."}
      >
        Authorization
      </DisplayHeading>
      <LeadText>
        {approved
          ? "You can return to the app or device where you started."
          : "No authorization was granted."}
      </LeadText>
      {approved ? (
        <Image
          alt=""
          aria-hidden="true"
          className="mx-auto size-50"
          height={200}
          src="/illustrations/checkmark.png"
          width={200}
        />
      ) : null}
      {approved ? (
        <PassportNavigation
          confirm={
            <Button className="w-full" onClick={goHome} size="lg" type="button">
              <ArrowRightIcon />
              Continue
            </Button>
          }
        />
      ) : (
        <PassportNavigation back={<BackButton onClick={goHome} />} />
      )}
    </PassportScreen>
  );
}

function goHome() {
  window.location.replace("/");
}

export { AuthorizationFlow };
