import { type ReactNode, useId } from "react";

import type { AuthorizationOutcome } from "@/client/logic/authorization/flow/authorizationOutcomeHandoff";
import {
  capabilityReach,
  type AuthorizationRequestReview,
} from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { CheckIcon, XIcon } from "@/client/ui/shared/icons";
import { shortPublicKey } from "@/client/ui/shared/formatPublicKey";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { SelectedIdentity } from "@/client/ui/shared/selectedIdentity";
import { PassportHeaderAction } from "@/client/ui/shared/passportHeaderAction";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { SHORT_WINDOW_GAP } from "@/client/ui/shared/shortWindow";
import { Button } from "@/client/ui/shared/primitives/button";
import { BroadAccessWarning } from "../broadAccessWarning";
import { describeRequester, RequestHeading, UnverifiedRequestNotice } from "../requestHeading";
import { PermissionList } from "./permissionList";
import { useAuthorizationRequester } from "../useAuthorizationRequester";
import { CallbackOriginWarning } from "../callbackOriginWarning";
import { OtherWaysIn } from "../otherWaysIn";

type ReviewPhase = "review" | "preparing" | "granting" | "completing";

/**
 * The second step of a request: what the app asks for, with the identity chosen in the list.
 * Switch returns to the list, where there is another identity to pick. Cancel sits in the header,
 * as on the list; below the request Authorize is the one primary action, and under it the same
 * "or" as on the list offers the start page and Pubky Ring.
 * Once an answer is on its way, the button that gave it shows the work (Authorize while signing
 * in and returning, Cancel while cancelling) and a status line says what happens, so a refusal
 * never looks like an approval.
 */
function AuthorizationReview({
  identity,
  onAuthorize,
  onCancel,
  onSwitch,
  onUseAnotherIdentity,
  onUseRing,
  phase,
  phaseOutcome,
  review,
}: {
  identity?: LocalIdentityMetadata | undefined;
  onAuthorize: () => void;
  onCancel: () => void;
  /** Absent with a single identity that can sign: there is no other one to switch to. */
  onSwitch?: (() => void) | undefined;
  /** Opens the start page for an identity that is not saved here yet. */
  onUseAnotherIdentity?: (() => void) | undefined;
  /** Hands the request to Pubky Ring unchanged. */
  onUseRing?: (() => void) | undefined;
  phase: ReviewPhase;
  /** The answer being handed back while `phase` is `completing`. */
  phaseOutcome?: AuthorizationOutcome | undefined;
  review: AuthorizationRequestReview;
}) {
  const busy = phase !== "review";
  const cancelling = phase === "completing" && phaseOutcome === "cancel";
  const signing = busy && !cancelling;
  const broad = describeBroadGrant(review.capabilities);
  // The line under the heading that names the website, or the notice that nobody verified who
  // asks; the Authorize button carries it as its description.
  const hostId = useId();
  // A39: an opener bound to this request by a v2 hello names it. M3: without one, the request's
  // own label and callback host name nobody, here and in every sentence below.
  const opener = useAuthorizationRequester(review);
  const { requester: label, labelledHost } = describeRequester(review);
  const requester = opener.bound ? label : "the app";
  const describedHost = opener.bound ? labelledHost !== undefined : opener.unverified;
  // Always mounted, so a screen reader hears each step of the answer as it changes, and as tall as
  // its wrapped copy, so the actions under it never move when a step starts.
  const status = (
    <p
      className="min-h-10 text-sm font-medium leading-5 text-muted-foreground [grid-area:1/1] md:min-h-5"
      role="status"
    >
      {progressMessage(phase, phaseOutcome, requester)}
    </p>
  );

  return (
    <PassportScreen>
      {/* Cancel answers the app from the header, as on the identity list; Authorize is the one
          action below the request. */}
      <PassportHeaderAction>
        <Button disabled={signing} loading={cancelling} onClick={onCancel} variant="secondary">
          <XIcon />
          {cancelling ? "Cancelling…" : "Cancel"}
        </Button>
      </PassportHeaderAction>
      {/* Tighter in a short window, like the identity list, so Authorize and the "or" under it
          stay in view in the app's 760px popup. */}
      <div className={cn("flex flex-1 flex-col gap-6", SHORT_WINDOW_GAP)}>
        <RequestHeading compact hostId={hostId} review={review} warning={false} />
        {/* From lg two columns of the track, as Manage identity's cards: what the app asks for on
            the left, the identity that answers and the answer itself on the right. Below lg one
            column in the same order, Authorize at the window's bottom on a phone. */}
        <div
          className={cn(
            "flex flex-1 flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-12",
            SHORT_WINDOW_GAP,
          )}
        >
          <div className={cn("flex min-w-0 flex-col gap-6", SHORT_WINDOW_GAP)}>
            <CallbackOriginWarning warning={opener.callbackWarning} />
            <BroadAccessWarning capabilities={review.capabilities} />
            <PermissionList callbackHost={opener.ownHost} capabilities={review.capabilities} />
          </div>
          <div className={cn("flex min-w-0 flex-1 flex-col gap-6", SHORT_WINDOW_GAP)}>
            <SelectedIdentity identity={identity} onSwitch={onSwitch} disabled={busy} />
            <div className="flex flex-col gap-2">
              <p className="break-words text-sm font-medium leading-5 text-muted-foreground">
                {describeWhatTheAppSees(review, identity, opener.bound ? label : undefined)}
                <strong className="font-bold text-foreground">
                  {describeAuthorizationEffect(
                    review.capabilities,
                    broad,
                    opener.bound && labelledHost ? `${label} (${labelledHost})` : requester,
                  )}
                </strong>
              </p>
              {opener.unverified ? null : status}
            </div>
            {opener.unverified ? (
              // M3: the warning stands right above Authorize and gives its place to each step of
              // the answer once Authorize is pressed, so neither moves the actions.
              <div className="grid">
                <UnverifiedRequestNotice
                  className={cn("[grid-area:1/1]", busy && "invisible")}
                  id={hostId}
                />
                {status}
              </div>
            ) : null}
            <Button
              aria-describedby={describedHost ? hostId : undefined}
              // A broad grant's longer label wraps on desktop too instead of overflowing its column.
              className={cn("mt-auto w-full md:mt-0", broad && "md:whitespace-normal")}
              disabled={!identity || cancelling}
              loading={signing}
              onClick={onAuthorize}
              size="lg"
              type="button"
            >
              <CheckIcon />
              {authorizationButtonLabel(phase, phaseOutcome, broad)}
            </Button>
            {onUseAnotherIdentity && onUseRing ? (
              <OtherWaysIn
                disabled={busy}
                onOpenRing={onUseRing}
                onUseAnotherIdentity={onUseAnotherIdentity}
              />
            ) : null}
          </div>
        </div>
      </div>
    </PassportScreen>
  );
}

function authorizationButtonLabel(
  phase: ReviewPhase,
  outcome: AuthorizationOutcome | undefined,
  broad: BroadGrant | undefined,
): string {
  if (phase === "preparing" || phase === "granting") return "Signing in…";
  if (phase === "completing" && outcome !== "cancel") return "Returning to the app…";
  // A request past the app's own folders names what the press gives, not just "Authorize".
  if (!broad) return "Authorize";
  return `Allow ${broad.write ? "changing" : "reading"} ${BROAD_REACH_LABEL[broad.reach]}`;
}

/** How far a request's broad capabilities reach, and whether any of them reads or writes. */
type BroadGrant = { reach: "all" | "public" | "private"; read: boolean; write: boolean };

const BROAD_REACH_LABEL = {
  all: "all your data",
  public: "all public data",
  private: "all private data",
} as const;
const BROAD_REACH_SENTENCE = {
  all: "all your data",
  public: "all your public data",
  private: "all your private data",
} as const;

function describeBroadGrant(
  capabilities: AuthorizationRequestReview["capabilities"],
): BroadGrant | undefined {
  const broad = capabilities.filter((capability) => capability.scope === "broad");
  if (broad.length === 0) return undefined;
  const reaches = new Set(broad.map((capability) => capabilityReach(capability.path)));
  // A broad path whose reach Passport cannot name is read as the widest reach.
  const reach =
    reaches.has("all") ||
    reaches.has(undefined) ||
    (reaches.has("public") && reaches.has("private"))
      ? "all"
      : reaches.has("public")
        ? "public"
        : "private";
  return {
    reach,
    read: broad.some((capability) => capability.read),
    write: broad.some((capability) => capability.write),
  };
}

function progressMessage(
  phase: ReviewPhase,
  outcome: AuthorizationOutcome | undefined,
  requester: string,
): string {
  switch (phase) {
    case "review":
      return "";
    case "preparing":
      return `Signing in to ${requester}…`;
    case "granting":
      return `Sending your approval to ${requester}. This can't be undone now.`;
    case "completing":
      if (outcome === "cancel") return `Telling ${requester} you cancelled…`;
      if (outcome === "error") return `The sign-in didn't work. Returning to ${requester}…`;
      return `Returning to ${requester}…`;
  }
}

/**
 * Asks the person to go on only if they started signing in to the verified `requester`, or, for a
 * request nobody verified (`requester` undefined), only if they started this sign-in themselves;
 * and says what the app gets and what it never does: the public key and public profile, never the
 * secret key or an attached Google account.
 */
function describeWhatTheAppSees(
  review: AuthorizationRequestReview,
  identity: LocalIdentityMetadata | undefined,
  requester: string | undefined,
): ReactNode {
  return (
    <>
      {requester === undefined
        ? "Only continue if you just started this sign-in yourself. "
        : review.callbackHost !== undefined
          ? `Only continue if you just started signing in to ${requester}. `
          : null}
      {identity ? (
        <>
          The app will see your public key{" "}
          {/* The short key reads as one value, so it never breaks at its ellipsis. */}
          <span className="whitespace-nowrap">
            ({shortPublicKey(identity.publicIdentity.publicKeyZ32)})
          </span>{" "}
          and your public profile, but not your secret key
          {identity.googleAccount ? " or your Google account" : null}.{" "}
        </>
      ) : null}
    </>
  );
}

/**
 * The bold sentence over the actions. A broad request says what its action label says, with the
 * same reach and verbs; any narrower rows it also asks for are listed above.
 */
function describeAuthorizationEffect(
  capabilities: AuthorizationRequestReview["capabilities"],
  broad: BroadGrant | undefined,
  requester: string,
): string {
  if (broad) {
    const verbs = broad.read && broad.write ? "read and change" : broad.write ? "change" : "read";
    const others = capabilities.some((capability) => capability.scope !== "broad")
      ? ", along with the other permissions listed"
      : "";
    return `Allowing this lets ${requester} ${verbs} ${BROAD_REACH_SENTENCE[broad.reach]}${others}.`;
  }
  const canRead = capabilities.some((capability) => capability.read);
  const canWrite = capabilities.some((capability) => capability.write);

  if (canRead && canWrite) {
    return `Authorizing will allow ${requester} to read and update your data.`;
  }
  if (canRead) return `Authorizing will allow ${requester} to read your data.`;
  if (canWrite) return `Authorizing will allow ${requester} to update your data.`;
  return "This request does not ask for data access.";
}

export { AuthorizationReview };
