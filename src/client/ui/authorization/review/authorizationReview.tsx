import { useId } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { CheckIcon, XIcon } from "@/client/ui/shared/icons";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { SelectedIdentity } from "@/client/ui/shared/selectedIdentity";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { BroadAccessWarning } from "../broadAccessWarning";
import { describeRequester, describesHost, RequestHeading } from "../requestHeading";
import { PermissionList } from "./permissionList";

/**
 * The second step of a request: what the app asks for, with the identity chosen in the list.
 * Switch returns to the list. A Ring-held identity continues in Pubky Ring instead of signing here.
 */
function AuthorizationReview({
  identity,
  onAuthorize,
  onCancel,
  onSwitch,
  phase,
  review,
}: {
  identity?: LocalIdentityMetadata | undefined;
  onAuthorize: () => void;
  onCancel: () => void;
  onSwitch: () => void;
  phase: "review" | "preparing" | "granting" | "completing";
  review: AuthorizationRequestReview;
}) {
  const busy = phase !== "review";
  // Ring signs with its own key, and the person picks the identity there.
  const heldInRing = identity?.keySource === "ring";
  const { requester, labelledHost } = describeRequester(review);
  // The line under the heading names the website, or says there is none; the Authorize button
  // carries it as its description.
  const hostId = useId();

  return (
    <PassportScreen>
      <div className="flex flex-1 flex-col gap-6">
        <RequestHeading hostId={hostId} review={review} />
        <BroadAccessWarning capabilities={review.capabilities} />
        <PermissionList capabilities={review.capabilities} />
        <SelectedIdentity identity={identity} onSwitch={onSwitch} disabled={busy} />
        {heldInRing ? (
          <p className="text-sm font-medium leading-5 text-muted-foreground">
            This identity is held in Pubky Ring. You choose the identity to sign in with in Ring.
          </p>
        ) : null}
        <p className="break-words text-sm font-medium leading-5 text-muted-foreground">
          Make sure you trust this service, browser, or device before authorizing with your pubky.{" "}
          <strong className="font-bold text-foreground">
            {describeAuthorizationEffect(
              review.capabilities,
              labelledHost ? `${requester} (${labelledHost})` : requester,
            )}
          </strong>
        </p>
        {phase === "granting" ? (
          <p aria-live="polite" className="text-sm font-medium leading-5 text-muted-foreground">
            The grant is being committed and can no longer be cancelled.
          </p>
        ) : null}
        <PassportNavigation
          back={
            <Button
              className="w-full"
              disabled={busy}
              onClick={onCancel}
              size="lg"
              type="button"
              variant="outline"
            >
              <XIcon />
              Cancel
            </Button>
          }
          className="mt-auto md:mt-0"
          confirm={
            <Button
              aria-describedby={describesHost(review) ? hostId : undefined}
              className="w-full"
              disabled={!identity}
              loading={busy}
              onClick={onAuthorize}
              size="lg"
              type="button"
            >
              {heldInRing ? <PubkyBrandIcon /> : <CheckIcon />}
              <span aria-live="polite">
                {heldInRing && phase === "review"
                  ? "Continue in Pubky Ring"
                  : authorizationButtonLabel(phase)}
              </span>
            </Button>
          }
        />
      </div>
    </PassportScreen>
  );
}

function authorizationButtonLabel(
  phase: "review" | "preparing" | "granting" | "completing",
): string {
  if (phase === "preparing") return "Preparing…";
  if (phase === "granting") return "Granting access…";
  if (phase === "completing") return "Completing…";
  return "Authorize";
}

function describeAuthorizationEffect(
  capabilities: AuthorizationRequestReview["capabilities"],
  requester: string,
): string {
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
