"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import {
  createPassportAuthorizationController,
  type PassportAuthorizationController,
  type PassportAuthorizationViewState,
} from "../../logic/authorization/passportAuthorization";
import type { LocalIdentityCatalog, PassportIdentityController } from "../../logic/identity/passportIdentityController";
import { IdentitySelectionFlow } from "../identity-catalog/selection/identitySelectionFlow";
import { useIdentityCatalog } from "../identity-catalog/useIdentityCatalog";
import { SignInFlow } from "../onboarding/signInFlow";
import { PassportScreen } from "../shared/layout/passportScreen";
import { BackButton } from "../shared/navigation/backButton";
import { Spinner } from "../shared/primitives/spinner";
import { DisplayHeading, LeadText } from "../shared/primitives/typography";
import { AuthorizationReview } from "./review/authorizationReview";
import { transitionAuthorizationView } from "./authorizationState";
import { InvalidAuthorization } from "./invalidAuthorization";
import { ManualAuthorization } from "./manual-entry/manualAuthorization";

function AuthorizationFlow({ googleClientId, homegateBaseUrl }: {
  googleClientId: string;
  homegateBaseUrl: string;
}) {
  const controllerRef = useRef<PassportAuthorizationController>(null);
  const [controller, setController] = useState<PassportAuthorizationController | null>(null);
  const [authorization, setAuthorization] = useState<PassportAuthorizationViewState>();

  useEffect(() => {
    const controller = controllerRef.current ?? createPassportAuthorizationController();
    controllerRef.current = controller;
    setController(controller);
    let active = true;
    const publish = () => { if (active) setAuthorization(controller.getState()); };
    const unsubscribe = controller.subscribe(publish);
    queueMicrotask(publish);
    controller.commitInitialEntry();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (!controller || !authorization) return <AuthorizationLoading label="Loading authorization" />;

  switch (authorization.status) {
    case "manual-entry":
      return <ManualAuthorization onBack={goHome} />;
    case "invalid":
      return <InvalidAuthorization onBack={goHome} />;
    case "failed":
      return (
        <PassportScreen className="gap-6">
          <DisplayHeading accent="failed." aria-label="Authorization failed.">Authorization</DisplayHeading>
          <LeadText>Passport could not authorize this request with the selected identity.</LeadText>
          <div className="mt-auto"><BackButton onClick={goHome} /></div>
        </PassportScreen>
      );
    case "approved":
      return <AuthorizationTerminal outcome="approved" />;
    case "cancelled":
      return <AuthorizationTerminal outcome="cancelled" />;
    case "review":
    case "approving":
    case "redirecting":
      return <AuthorizationWithIdentity
        authorization={authorization}
        controller={controller}
        googleClientId={googleClientId}
        homegateBaseUrl={homegateBaseUrl}
      />;
  }
}

function AuthorizationWithIdentity({ authorization, controller, googleClientId, homegateBaseUrl }: {
  authorization: Extract<PassportAuthorizationViewState, { status: "review" | "approving" | "redirecting" }>;
  controller: PassportAuthorizationController;
  googleClientId: string;
  homegateBaseUrl: string;
}) {
  const identityCatalog = useIdentityCatalog(googleClientId, homegateBaseUrl);

  switch (identityCatalog.status) {
    case "loading":
      return <AuthorizationLoading label="Loading identities" />;
    case "unavailable":
      return <PassportScreen className="gap-6"><DisplayHeading accent="unavailable." aria-label="Identities unavailable.">Identities</DisplayHeading><LeadText>Passport could not read identities stored in this browser.</LeadText><div className="mt-auto"><BackButton onClick={goHome} /></div></PassportScreen>;
    case "ready":
      return <ReadyAuthorizationWithIdentity
        authorization={authorization}
        authorizationController={controller}
        catalog={identityCatalog.catalog}
        identityController={identityCatalog.controller}
        reloadIdentities={identityCatalog.reloadIdentities}
      />;
  }
}

function ReadyAuthorizationWithIdentity({ authorization, authorizationController, catalog, identityController, reloadIdentities }: {
  authorization: Extract<PassportAuthorizationViewState, { status: "review" | "approving" | "redirecting" }>;
  authorizationController: PassportAuthorizationController;
  catalog: LocalIdentityCatalog;
  identityController: PassportIdentityController;
  reloadIdentities: () => void;
}) {
  const [onboardingRequired, setOnboardingRequired] = useState(catalog.identities.length === 0);
  const [view, dispatch] = useReducer(transitionAuthorizationView, { view: "review" });

  if (onboardingRequired) {
    return <SignInFlow
      controller={identityController}
      onBack={() => { void authorizationController.cancel(); }}
      onComplete={() => {
        reloadIdentities();
        setOnboardingRequired(false);
      }}
    />;
  }

  if (view.view === "identity-selection") {
    return <IdentitySelectionFlow
      catalog={catalog}
      controller={identityController}
      onBack={() => dispatch({ type: "selection-finished" })}
      onIdentitySelected={() => {
        reloadIdentities();
        dispatch({ type: "selection-finished" });
      }}
    />;
  }

  const activeIdentity = catalog.identities.find(
    (identity) => identity.id === catalog.activeIdentityId,
  );
  return <AuthorizationReview
    approving={authorization.status !== "review"}
    {...(activeIdentity ? { identity: activeIdentity } : {})}
    onAuthorize={() => {
      void authorizationController.approve();
    }}
    onCancel={() => {
      void authorizationController.cancel();
    }}
    onSwitch={() => dispatch({ type: "switch-requested" })}
    review={authorization.review}
  />;
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
      <LeadText>{approved
        ? "You can return to the requesting app."
        : "No authorization was granted."}</LeadText>
      <div className="mt-auto"><BackButton onClick={goHome} /></div>
    </PassportScreen>
  );
}

function AuthorizationLoading({ label }: { label: string }) {
  return <main aria-label={label} className="grid min-h-[calc(100svh-84px)] place-items-center"><Spinner /></main>;
}

function goHome() {
  window.location.replace("/");
}

export { AuthorizationFlow };
