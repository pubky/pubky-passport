"use client";

import { Result } from "better-result";
import { useEffect, useReducer, useRef, useState } from "react";

import {
  PassportAuthorizationController,
  type PassportAuthorizationViewState,
} from "../../logic/authorization/PassportAuthorizationController";
import type { LocalIdentityController } from "../../logic/local-identity/LocalIdentityController";
import type { LocalIdentityCatalog } from "../../logic/local-identity/localIdentityModels";
import type { GoogleIdentityConfiguration } from "../../logic/google-identity/GoogleIdentityFlow";
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
  const googleIdentityConfiguration = { googleClientId, homegateBaseUrl };
  const controllerRef = useRef<PassportAuthorizationController>(null);
  const mountedRef = useRef(false);
  const [controller, setController] = useState<PassportAuthorizationController | null>(null);
  const [authorization, setAuthorization] = useState<PassportAuthorizationViewState>();

  useEffect(() => {
    mountedRef.current = true;
    const controller = controllerRef.current ?? new PassportAuthorizationController();
    controllerRef.current = controller;
    setController(controller);
    let active = true;
    const publish = () => { if (active) setAuthorization(controller.getState()); };
    const unsubscribe = controller.subscribe(publish);
    queueMicrotask(publish);
    return () => {
      mountedRef.current = false;
      active = false;
      unsubscribe();
      // StrictMode replays effects; defer disposal so the immediate setup can retain it.
      queueMicrotask(() => {
        if (!mountedRef.current) controller.dispose();
      });
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
    case "completing":
      return <AuthorizationWithIdentity
        authorization={authorization}
        controller={controller}
        googleIdentityConfiguration={googleIdentityConfiguration}
      />;
  }
}

function AuthorizationWithIdentity({ authorization, controller, googleIdentityConfiguration }: {
  authorization: Extract<PassportAuthorizationViewState, { status: "review" | "approving" | "completing" }>;
  controller: PassportAuthorizationController;
  googleIdentityConfiguration: GoogleIdentityConfiguration;
}) {
  const identityCatalog = useIdentityCatalog();

  switch (identityCatalog.status) {
    case "loading":
      return <AuthorizationLoading label="Loading identities" />;
    case "unavailable":
      return (
        <PassportScreen className="gap-6">
          <DisplayHeading accent="unavailable." aria-label="Identities unavailable.">
            Identities
          </DisplayHeading>
          <LeadText>Passport could not read identities stored on this device.</LeadText>
          <div className="mt-auto">
            <BackButton onClick={() => { void controller.cancel(); }} />
          </div>
        </PassportScreen>
      );
    case "ready":
      return <ReadyAuthorizationWithIdentity
        authorization={authorization}
        authorizationController={controller}
        catalog={identityCatalog.catalog}
        googleIdentityConfiguration={googleIdentityConfiguration}
        identityController={identityCatalog.controller}
        reloadIdentities={identityCatalog.reloadIdentities}
      />;
  }
}

function ReadyAuthorizationWithIdentity({ authorization, authorizationController, catalog, googleIdentityConfiguration, identityController, reloadIdentities }: {
  authorization: Extract<PassportAuthorizationViewState, { status: "review" | "approving" | "completing" }>;
  authorizationController: PassportAuthorizationController;
  catalog: LocalIdentityCatalog;
  googleIdentityConfiguration: GoogleIdentityConfiguration;
  identityController: LocalIdentityController;
  reloadIdentities: () => void;
}) {
  const [onboardingRequired, setOnboardingRequired] = useState(catalog.identities.length === 0);
  const [view, dispatch] = useReducer(transitionAuthorizationView, { view: "review" });

  if (onboardingRequired) {
    return <SignInFlow
      googleIdentityConfiguration={googleIdentityConfiguration}
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
      googleIdentityConfiguration={googleIdentityConfiguration}
      onBack={() => dispatch({ type: "selection-finished" })}
      onIdentitySelected={() => {
        reloadIdentities();
        dispatch({ type: "selection-finished" });
      }}
      selectIdentity={(publicKeyZ32) => Result.isOk(identityController.selectIdentity(publicKeyZ32))}
    />;
  }

  const activeIdentity = catalog.identities.find(
    (identity) => identity.publicIdentity.publicKeyZ32 === catalog.activePublicKeyZ32,
  );
  return <AuthorizationReview
    {...(activeIdentity ? { identity: activeIdentity } : {})}
    onAuthorize={() => {
      if (activeIdentity) {
        void authorizationController.approve(activeIdentity.publicIdentity.publicKeyZ32);
      }
    }}
    onCancel={() => {
      void authorizationController.cancel();
    }}
    onSwitch={() => dispatch({ type: "switch-requested" })}
    phase={authorization.status}
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
        ? "You can return to the app or device where you started."
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
