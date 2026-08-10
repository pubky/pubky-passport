"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import {
  createPassportAuthorizationController,
  type PassportAuthorizationController,
  type PassportAuthorizationViewState,
} from "../../browser/authorization/passportAuthorization";
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
    case "cancelled":
      return <AuthorizationLoading label="Completing authorization" />;
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
  const [view, dispatch] = useReducer(transitionAuthorizationView, { view: "review" });

  switch (identityCatalog.status) {
    case "loading":
      return <AuthorizationLoading label="Loading identities" />;
    case "unavailable":
      return <PassportScreen className="gap-6"><DisplayHeading accent="unavailable." aria-label="Identities unavailable.">Identities</DisplayHeading><LeadText>Passport could not read identities stored in this browser.</LeadText><div className="mt-auto"><BackButton onClick={goHome} /></div></PassportScreen>;
    case "ready": {
      if (identityCatalog.catalog.identities.length === 0) {
        return <SignInFlow
          controller={identityCatalog.controller}
          onComplete={() => dispatch({ type: "selection-finished" })}
        />;
      }

      if (view.view === "identity-selection") {
        return <IdentitySelectionFlow
          catalog={identityCatalog.catalog}
          controller={identityCatalog.controller}
          onBack={() => dispatch({ type: "selection-finished" })}
          onIdentitySelected={() => dispatch({ type: "selection-finished" })}
        />;
      }

      const activeIdentity = identityCatalog.catalog.identities.find(
        (identity) => identity.id === identityCatalog.catalog.activeIdentityId,
      );
      return <AuthorizationReview
        approving={authorization.status !== "review"}
        {...(activeIdentity ? { identity: activeIdentity } : {})}
        onAuthorize={() => {
          void controller.approve().then((next) => {
            if (next.status === "approved") goHome();
          });
        }}
        onCancel={() => {
          if (controller.cancel().status === "cancelled") goHome();
        }}
        onSwitch={() => dispatch({ type: "switch-requested" })}
        review={authorization.review}
      />;
    }
  }
}

function AuthorizationLoading({ label }: { label: string }) {
  return <main aria-label={label} className="grid min-h-[calc(100svh-84px)] place-items-center"><Spinner /></main>;
}

function goHome() {
  window.location.replace("/");
}

export { AuthorizationFlow };
