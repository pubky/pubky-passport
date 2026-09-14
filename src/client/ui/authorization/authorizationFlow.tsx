"use client";

import Image from "next/image";
import { useState } from "react";
import { preload } from "react-dom";

import type { PassportAuthorizationViewState } from "../../logic/authorization/flow/PassportAuthorizationController";
import { IdentitySelectionFlow } from "../identity-catalog/selection/identitySelectionFlow";
import { useIdentityCatalog } from "../identity-catalog/useIdentityCatalog";
import { IdentityEstablishmentFlow } from "../onboarding/identityEstablishmentFlow";
import { ArrowRightIcon } from "../shared/icons";
import { BackButton } from "../shared/backButton";
import { PassportNavigation } from "../shared/passportNavigation";
import { PassportScreen } from "../shared/passportScreen";
import { Button } from "../shared/primitives/button";
import { Spinner } from "../shared/primitives/spinner";
import { DisplayHeading, LeadText } from "../shared/primitives/typography";
import { usePassportCollaborators, type IdentitySetup } from "../passportCollaborators";
import { SignInBand } from "./signInBand";
import { AuthorizationReview } from "./review/authorizationReview";
import { InvalidAuthorization } from "./invalidAuthorization";
import { ManualAuthorization } from "./manual-entry/manualAuthorization";
import { usePassportAuthorization } from "./usePassportAuthorization";

function AuthorizationFlow() {
  const { IdentitySetup } = usePassportCollaborators();
  const Setup = IdentitySetup ?? IdentityEstablishmentFlow;
  const { controller: passportAuthorizationController, state: authorization } =
    usePassportAuthorization();

  if (!passportAuthorizationController || !authorization) {
    return <AuthorizationLoading label="Loading authorization" />;
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
            IdentitySetup={Setup}
            authorization={authorization}
            passportAuthorizationController={passportAuthorizationController}
          />
        </>
      );
  }
}

function AuthorizationWithIdentity({
  IdentitySetup,
  authorization,
  passportAuthorizationController,
}: {
  IdentitySetup: IdentitySetup;
  authorization: Extract<
    PassportAuthorizationViewState,
    { status: "review" | "preparing" | "granting" | "completing" }
  >;
  passportAuthorizationController: NonNullable<
    ReturnType<typeof usePassportAuthorization>["controller"]
  >;
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
    case "ready": {
      const { actions, catalog } = identityCatalog;

      if (catalog.identities.length === 0) {
        return (
          <IdentitySetup
            forAuthorization
            onBack={() => {
              void passportAuthorizationController.cancel();
            }}
            onComplete={() => undefined}
          />
        );
      }

      if (view === "identity-selection") {
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
          {...(activeIdentity ? { identity: activeIdentity } : {})}
          onAuthorize={() => {
            if (activeIdentity) {
              void passportAuthorizationController.approve(
                activeIdentity.publicIdentity.publicKeyZ32,
              );
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

function AuthorizationLoading({ label }: { label: string }) {
  return (
    <main
      aria-label={label}
      className="grid min-h-[calc(100svh-var(--passport-header-height)-var(--passport-context-band-height))] place-items-center"
    >
      <Spinner />
    </main>
  );
}

function goHome() {
  window.location.replace("/");
}

export { AuthorizationFlow };
