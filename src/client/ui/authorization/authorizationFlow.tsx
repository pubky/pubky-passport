"use client";

import Image from "next/image";
import { preload } from "react-dom";
import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { AuthorizationController } from "./usePassportAuthorization";
import { ArrowRightIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { AuthorizationReview } from "./review/authorizationReview";
import { InvalidAuthorization } from "./invalidAuthorization";

/** Every state of a supplied request; without one, the shell offers manual entry instead. */
export type AuthorizationRequestState = Exclude<
  PassportAuthorizationViewState,
  { status: "manual-entry" }
>;

/**
 * Review, approval progress, and outcome of a supplied request. A Ring-held identity cannot sign
 * here, so authorizing with it hands the unchanged request to Ring through `onUseRing`.
 */
export function AuthorizationFlow({
  authorization,
  controller,
  identity,
  onSwitch,
  onUseRing,
}: {
  authorization: AuthorizationRequestState;
  controller: AuthorizationController;
  identity?: LocalIdentityMetadata | undefined;
  onSwitch: () => void;
  onUseRing?: (() => void) | undefined;
}) {
  if (authorization.status === "completing")
    preload("/illustrations/checkmark.png", { as: "image" });
  switch (authorization.status) {
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
    case "handed-off":
      return <AuthorizationTerminal outcome="handed-off" />;
    case "cancelled":
      return <AuthorizationTerminal outcome="cancelled" />;
    default:
      return (
        <AuthorizationReview
          identity={identity}
          onAuthorize={() => {
            if (identity?.keySource === "ring") onUseRing?.();
            else if (identity) void controller.approve(identity.publicIdentity.publicKeyZ32);
          }}
          onCancel={() => {
            void controller.cancel();
          }}
          onSwitch={onSwitch}
          onUseRing={onUseRing}
          phase={authorization.status}
          review={authorization.review}
        />
      );
  }
}

const TERMINAL_COPY = {
  approved: {
    title: "Authorization",
    accent: "complete.",
    lead: "You can return to the app or device where you started.",
  },
  // Passport cannot see an external signer's approval, so it never claims one.
  "handed-off": {
    title: "Return to",
    accent: "the app.",
    lead: "Passport cannot see the approval in Pubky Ring. The app signs you in once the approval reaches it.",
  },
  cancelled: {
    title: "Authorization",
    accent: "cancelled.",
    lead: "No authorization was granted.",
  },
} as const;

function AuthorizationTerminal({ outcome }: { outcome: keyof typeof TERMINAL_COPY }) {
  const approved = outcome === "approved";
  const copy = TERMINAL_COPY[outcome];
  return (
    <PassportScreen className="gap-6">
      <DisplayHeading accent={copy.accent} aria-label={`${copy.title} ${copy.accent}`}>
        {copy.title}
      </DisplayHeading>
      <LeadText>{copy.lead}</LeadText>
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
      {outcome !== "cancelled" ? (
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

/** Leaves the request entry for the home page, where identity management lives. */
function goHome() {
  window.location.replace("/");
}
