"use client";

import type { ReactNode } from "react";
import { preload } from "react-dom";
import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type { AuthorizationController } from "./usePassportAuthorization";
import { ErrorScreen } from "@/client/ui/shared/errorScreen";
import { identityDisplayName, profileName } from "@/client/ui/shared/identityDisplay";
import { OutcomeScreen } from "@/client/ui/shared/outcomeScreen";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { AuthorizationReview } from "./review/authorizationReview";
import { InvalidAuthorization } from "./invalidAuthorization";
import { FittedRequester, requesterWindowTitle } from "./requestHeading";
import { GoToPassportLink, RequestExitAction, useOpenedByApp } from "./requestExit";

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
  if (authorization.status === "completing" && authorization.outcome === "success")
    preload("/illustrations/checkmark.png", { as: "image" });
  switch (authorization.status) {
    case "invalid":
    case "expired":
      return <InvalidAuthorization reason={authorization.status} />;
    case "failed":
      return (
        <AuthorizationFailed
          identity={identity}
          reason={authorization.reason}
          review={authorization.review}
        />
      );
    case "approved":
      return <AuthorizationApproved identity={identity} review={authorization.review} />;
    case "handed-off":
    case "cancelled":
      return <AuthorizationEnded outcome={authorization.status} review={authorization.review} />;
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
          phase={authorization.status}
          phaseOutcome={authorization.status === "completing" ? authorization.outcome : undefined}
          review={authorization.review}
        />
      );
  }
}

/**
 * The name an outcome gives the app: its own label, else its callback host, and only while a
 * callback host backs it (the band above the screen names that host, and the window title carries
 * it; see `requesterWindowTitle`). A request without one names no website, so its outcome is not
 * named after the label it chose: `undefined`, and the copy stays generic.
 */
function outcomeRequester({
  requesterName,
  callbackHost,
}: AuthorizationRequestReview): string | undefined {
  return callbackHost ? (requesterName ?? callbackHost) : undefined;
}

/**
 * An identity's name in running text. One named after its key reads as one value, so it never
 * breaks at the ellipsis of its short key; a profile name wraps like any other words.
 */
function IdentityName({ identity }: { identity: LocalIdentityMetadata }) {
  const name = identityDisplayName(identity);
  return profileName(identity) ? name : <span className="whitespace-nowrap">{name}</span>;
}

/** A name as a heading accent, fitted like the review's requester, or `fallback` without one. */
function fittedAccent(name: string | undefined, fallback: string): ReactNode {
  return name ? <FittedRequester>{name}</FittedRequester> : fallback;
}

function AuthorizationApproved({
  identity,
  review,
}: {
  identity: LocalIdentityMetadata | undefined;
  review: AuthorizationRequestReview;
}) {
  const inPopup = useOpenedByApp();
  const requester = outcomeRequester(review);
  return (
    <OutcomeScreen
      accent={fittedAccent(requester, "approved.")}
      action={<RequestExitAction inPopup={inPopup} />}
      description={
        <>
          Passport sent your approval
          {identity ? (
            <>
              {" as "}
              <IdentityName identity={identity} />
            </>
          ) : null}
          . You can go back to {requester ?? "the app"} now.
        </>
      }
      label={requester ? `Signed in to ${requester}` : "Sign-in approved."}
      title={requester ? "Signed in to" : "Sign-in"}
      windowTitle={requesterWindowTitle("Signed in to", review)}
    />
  );
}

/**
 * A failed approval, told apart by what failed: the chosen identity's key (another identity, or the
 * identity restored the way it was added, may work) or the approval's way to the app (only a new
 * sign-in from the app helps). The app's popup offers Passport's start page as a side action, where
 * the identity can be restored.
 */
function AuthorizationFailed({
  identity,
  reason,
  review,
}: {
  identity: LocalIdentityMetadata | undefined;
  reason: "identity" | "delivery";
  review: AuthorizationRequestReview;
}) {
  const inPopup = useOpenedByApp();
  const requester = outcomeRequester(review);
  const app = requester ?? "the app";
  const name = identity ? identityDisplayName(identity) : undefined;
  // An identity with a Google account comes back through Continue with Google, not a file.
  const restore = identity?.googleAccount
    ? "restore this one with Continue with Google on Passport's start page"
    : "restore this one from its recovery file";
  const copy =
    reason === "identity"
      ? {
          title: "Couldn't use",
          accent: fittedAccent(name, "this identity."),
          label: `Couldn't use ${name ?? "this identity"}.`,
          windowTitle: undefined,
          cause: identity ? (
            <>
              Passport couldn&apos;t unlock the key of <IdentityName identity={identity} /> in this
              browser.
            </>
          ) : (
            "Passport couldn't unlock this identity's key in this browser."
          ),
          nextStep: `Go back to ${app} and sign in again with another identity, or ${restore}.`,
        }
      : {
          title: "Couldn't reach",
          accent: fittedAccent(requester, "the app."),
          label: requester ? `Couldn't reach ${requester}` : undefined,
          windowTitle: requesterWindowTitle("Couldn't reach", review),
          cause: `Your approval didn't reach ${app}.`,
          nextStep: `Go back to ${app} and start signing in again.`,
        };
  return (
    <ErrorScreen
      accent={copy.accent}
      action={<RequestExitAction inPopup={inPopup} />}
      cause={copy.cause}
      label={copy.label}
      nextStep={copy.nextStep}
      secondaryAction={inPopup ? <GoToPassportLink /> : undefined}
      title={copy.title}
      windowTitle={copy.windowTitle}
    />
  );
}

/** Cancelled here, or handed to Pubky Ring, whose approval Passport cannot see or claim. */
function AuthorizationEnded({
  outcome,
  review,
}: {
  outcome: "cancelled" | "handed-off";
  review: AuthorizationRequestReview;
}) {
  const inPopup = useOpenedByApp();
  const requester = outcomeRequester(review);
  const copy =
    outcome === "cancelled"
      ? {
          title: "Sign-in",
          accent: "cancelled." as ReactNode,
          label: "Sign-in cancelled.",
          windowTitle: undefined,
          lead: requester ? `Nothing was shared with ${requester}.` : "Nothing was shared.",
        }
      : {
          title: "Return to",
          accent: fittedAccent(requester, "the app."),
          label: requester ? `Return to ${requester}` : "Return to the app.",
          windowTitle: requesterWindowTitle("Return to", review),
          lead: `Passport cannot see the approval in Pubky Ring. ${requester ?? "The app"} signs you in once the approval reaches it.`,
        };
  return (
    <PassportScreen className="gap-6">
      <DisplayHeading
        accent={copy.accent}
        aria-label={copy.label}
        data-window-title={copy.windowTitle}
      >
        {copy.title}
      </DisplayHeading>
      <LeadText>{copy.lead}</LeadText>
      <PassportNavigation
        className="mt-auto md:mt-0"
        confirm={<RequestExitAction inPopup={inPopup} />}
      />
    </PassportScreen>
  );
}
