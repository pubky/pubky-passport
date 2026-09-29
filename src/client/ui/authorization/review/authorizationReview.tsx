import { type ReactNode, useId } from "react";

import type { AuthorizationOutcome } from "@/client/logic/authorization/flow/authorizationOutcomeHandoff";
import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { CheckIcon, XIcon } from "@/client/ui/shared/icons";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { shortPublicKey } from "@/client/ui/shared/formatPublicKey";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { SelectedIdentity } from "@/client/ui/shared/selectedIdentity";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { BroadAccessWarning } from "../broadAccessWarning";
import { describeRequester, describesHost, RequestHeading } from "../requestHeading";
import { PermissionList } from "./permissionList";

type ReviewPhase = "review" | "preparing" | "granting" | "completing";

/**
 * The second step of a request: what the app asks for, with the identity chosen in the list.
 * Switch returns to the list. A Ring-held identity continues in Pubky Ring instead of signing here.
 * Once an answer is on its way, the button that gave it shows the work (Authorize while signing
 * in and returning, Cancel while cancelling) and a status line says what happens, so a refusal
 * never looks like an approval.
 */
function AuthorizationReview({
  identity,
  onAuthorize,
  onCancel,
  onSwitch,
  phase,
  phaseOutcome,
  review,
}: {
  identity?: LocalIdentityMetadata | undefined;
  onAuthorize: () => void;
  onCancel: () => void;
  onSwitch: () => void;
  phase: ReviewPhase;
  /** The answer being handed back while `phase` is `completing`. */
  phaseOutcome?: AuthorizationOutcome | undefined;
  review: AuthorizationRequestReview;
}) {
  const busy = phase !== "review";
  const cancelling = phase === "completing" && phaseOutcome === "cancel";
  const signing = busy && !cancelling;
  // Ring signs with its own key, and the person picks the identity there.
  const heldInRing = identity?.keySource === "ring";
  const { requester, labelledHost } = describeRequester(review);
  const broad = describeBroadGrant(review.capabilities);
  // The line under the heading names the website, or says there is none; the Authorize button
  // carries it as its description.
  const hostId = useId();

  return (
    <PassportScreen>
      <div className="flex flex-1 flex-col gap-6">
        <RequestHeading hostId={hostId} review={review} />
        <BroadAccessWarning capabilities={review.capabilities} />
        <PermissionList callbackHost={review.callbackHost} capabilities={review.capabilities} />
        <SelectedIdentity identity={identity} onSwitch={onSwitch} disabled={busy} />
        {heldInRing ? (
          <p className="text-sm font-medium leading-5 text-muted-foreground">
            This identity is held in Pubky Ring. You choose the identity to sign in with in Ring.
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          <p className="break-words text-sm font-medium leading-5 text-muted-foreground">
            {describeWhatTheAppSees(review, heldInRing ? undefined : identity)}
            <strong className="font-bold text-foreground">
              {describeAuthorizationEffect(
                review.capabilities,
                broad,
                labelledHost ? `${requester} (${labelledHost})` : requester,
              )}
            </strong>
          </p>
          {/* Always mounted, so a screen reader hears each step of the answer as it changes, and
              as tall as its wrapped copy, so the actions under it never move when a step starts. */}
          <p
            className="min-h-10 text-sm font-medium leading-5 text-muted-foreground md:min-h-5"
            role="status"
          >
            {progressMessage(phase, phaseOutcome, requester)}
          </p>
        </div>
        <PassportNavigation
          back={
            <Button
              className="w-full"
              disabled={signing}
              loading={cancelling}
              onClick={onCancel}
              size="lg"
              type="button"
              variant="outline"
            >
              <XIcon />
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          }
          className="mt-auto md:mt-0"
          confirm={
            <Button
              aria-describedby={describesHost(review) ? hostId : undefined}
              // The column beside Cancel is narrow on desktop; a broad grant's longer label wraps.
              className={cn("w-full", broad && "md:whitespace-normal")}
              disabled={!identity || cancelling}
              loading={signing}
              onClick={onAuthorize}
              size="lg"
              type="button"
            >
              {heldInRing ? <PubkyBrandIcon /> : <CheckIcon />}
              {authorizationButtonLabel(phase, phaseOutcome, { broad, heldInRing })}
            </Button>
          }
        />
      </div>
    </PassportScreen>
  );
}

function authorizationButtonLabel(
  phase: ReviewPhase,
  outcome: AuthorizationOutcome | undefined,
  { broad, heldInRing }: { broad: BroadGrant | undefined; heldInRing: boolean },
): string {
  if (phase === "preparing" || phase === "granting") return "Signing in…";
  if (phase === "completing" && outcome !== "cancel") return "Returning to the app…";
  if (heldInRing) return "Continue in Pubky Ring";
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
  const paths = new Set(broad.map((capability) => capability.path));
  const both = paths.has("/pub/") && paths.has("/priv/");
  // A broad path Passport does not know by name is read as the widest reach.
  const reach =
    paths.has("/") || both || [...paths].some((path) => path !== "/pub/" && path !== "/priv/")
      ? "all"
      : paths.has("/pub/")
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
 * Asks the person to go on only if they started this sign-in (a request without a website says
 * so under its heading instead), and says what the app gets and what it never does: the public
 * key and public profile, never the secret key or an attached Google account.
 */
function describeWhatTheAppSees(
  review: AuthorizationRequestReview,
  identity: LocalIdentityMetadata | undefined,
): ReactNode {
  const { requester } = describeRequester(review);
  return (
    <>
      {review.callbackHost !== undefined
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
