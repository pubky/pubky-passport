"use client";

import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import {
  PassportAuthorizationController,
  type PassportAuthorizationViewState,
} from "../../logic/authorization/flow/PassportAuthorizationController";
import type { GoogleIdentityConfiguration } from "../../logic/google-identity/GoogleIdentityController";
import { IdentitySelectionFlow } from "../identity-catalog/selection/identitySelectionFlow";
import { useIdentityCatalog } from "../identity-catalog/useIdentityCatalog";
import { SignInFlow } from "../onboarding/signInFlow";
import { BackButton } from "../shared/backButton";
import { PassportScreen } from "../shared/passportScreen";
import { Spinner } from "../shared/primitives/spinner";
import { DisplayHeading, LeadText } from "../shared/primitives/typography";
import { AuthorizationReview } from "./review/authorizationReview";
import { InvalidAuthorization } from "./invalidAuthorization";
import { ManualAuthorization } from "./manual-entry/manualAuthorization";

function AuthorizationFlow({ googleClientId, homegateBaseUrl }: {
  googleClientId: string;
  homegateBaseUrl: string;
}) {
  const googleIdentityConfiguration = { googleClientId, homegateBaseUrl };
  const passportAuthorizationControllerRef = useRef<PassportAuthorizationController>(null);
  const mountedRef = useRef(false);
  const [passportAuthorizationController, setPassportAuthorizationController] =
    useState<PassportAuthorizationController | null>(null);
  const [authorization, setAuthorization] = useState<PassportAuthorizationViewState>();

  useEffect(() => {
    mountedRef.current = true;
    const passportAuthorizationController = passportAuthorizationControllerRef.current
      ?? new PassportAuthorizationController();
    passportAuthorizationControllerRef.current = passportAuthorizationController;
    setPassportAuthorizationController(passportAuthorizationController);
    let active = true;
    const publish = () => {
      if (active) setAuthorization(passportAuthorizationController.getState());
    };
    const unsubscribe = passportAuthorizationController.subscribe(publish);
    queueMicrotask(publish);
    return () => {
      mountedRef.current = false;
      active = false;
      unsubscribe();
      // StrictMode replays effects; defer disposal so the immediate setup can retain it.
      queueMicrotask(() => {
        if (!mountedRef.current) passportAuthorizationController.dispose();
      });
    };
  }, []);

  if (!passportAuthorizationController || !authorization) {
    return <AuthorizationLoading label="Loading authorization" />;
  }

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
        passportAuthorizationController={passportAuthorizationController}
        googleIdentityConfiguration={googleIdentityConfiguration}
      />;
  }
}

function AuthorizationWithIdentity({
  authorization,
  passportAuthorizationController,
  googleIdentityConfiguration,
}: {
  authorization: Extract<PassportAuthorizationViewState, { status: "review" | "approving" | "completing" }>;
  passportAuthorizationController: PassportAuthorizationController;
  googleIdentityConfiguration: GoogleIdentityConfiguration;
}) {
  const identityCatalog = useIdentityCatalog();
  const [view, setView] = useState<"review" | "identity-selection">("review");

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
            <BackButton onClick={() => { void passportAuthorizationController.cancel(); }} />
          </div>
        </PassportScreen>
      );
    case "ready": {
      const { catalog, localIdentityController, reloadIdentities } = identityCatalog;

      if (catalog.identities.length === 0) {
        return <SignInFlow
          googleIdentityConfiguration={googleIdentityConfiguration}
          onBack={() => { void passportAuthorizationController.cancel(); }}
          onComplete={reloadIdentities}
        />;
      }

      if (view === "identity-selection") {
        return <IdentitySelectionFlow
          catalog={catalog}
          googleIdentityConfiguration={googleIdentityConfiguration}
          onBack={() => setView("review")}
          onIdentitySelected={() => {
            reloadIdentities();
            setView("review");
          }}
          selectIdentity={(publicKeyZ32) => Result.isOk(localIdentityController.selectIdentity(publicKeyZ32))}
        />;
      }

      const activeIdentity = catalog.identities.find(
        (identity) => identity.publicIdentity.publicKeyZ32 === catalog.activePublicKeyZ32,
      );
      return <AuthorizationReview
        {...(activeIdentity ? { identity: activeIdentity } : {})}
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
      />;
    }
  }
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
