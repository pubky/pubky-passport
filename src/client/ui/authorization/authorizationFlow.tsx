"use client";

import Image from "next/image";
import { useState } from "react";
import { preload } from "react-dom";

import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";
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
type AuthorizationIdentityView = "first-identity-setup" | "review" | "identity-selection";

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
  const [view, setView] = useState<AuthorizationIdentityView>(() =>
    catalog.identities.length === 0 ? "first-identity-setup" : "review",
  );
  const resolvedView: AuthorizationIdentityView =
    catalog.identities.length === 0 ? "first-identity-setup" : view;

  if (resolvedView === "first-identity-setup") {
    return (
      <Setup
        forAuthorization
        onBack={() => {
          void passportAuthorizationController.cancel();
        }}
        onComplete={() => setView("review")}
      />
    );
  }

  if (resolvedView === "identity-selection") {
    return (
      <IdentitySelectionFlow
        catalog={catalog}
        forAuthorization
        onBack={() => setView("review")}
        onIdentitySelected={() => setView("review")}
        selectIdentity={actions.selectIdentity}
      />
    );
  }

  const activeIdentity = catalog.identities.find(
    (identity) => identity.publicIdentity.publicKeyZ32 === catalog.activePublicKeyZ32,
  );
  return (
    <AuthorizationReview
      identity={activeIdentity}
      onAuthorize={() => {
        if (activeIdentity) {
          void passportAuthorizationController.approve(activeIdentity.publicIdentity.publicKeyZ32);
        }
      }}
      onCancel={() => {
        void passportAuthorizationController.cancel();
      }}
      onSwitch={() => setView("identity-selection")}
      phase={authorization.status}
      review={authorization.review}
    />
  );
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
          className="mx-auto size-[200px]"
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
