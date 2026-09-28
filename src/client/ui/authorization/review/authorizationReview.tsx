import { useId, useLayoutEffect, useRef } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { CheckIcon, TriangleAlertIcon, XIcon } from "@/client/ui/shared/icons";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { SelectedIdentity } from "@/client/ui/shared/selectedIdentity";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";
import { PermissionList } from "./permissionList";

function AuthorizationReview({
  identity,
  onAuthorize,
  onCancel,
  onSwitch,
  onUseRing,
  phase,
  review,
}: {
  identity?: LocalIdentityMetadata | undefined;
  onAuthorize: () => void;
  onCancel: () => void;
  onSwitch: () => void;
  onUseRing?: (() => void) | undefined;
  phase: "review" | "preparing" | "granting" | "completing";
  review: AuthorizationRequestReview;
}) {
  const busy = phase !== "review";
  // Ring signs with its own key, and the person picks the identity there.
  const heldInRing = identity?.keySource === "ring";
  const broadAccessWarning = describeBroadAccess(review.capabilities);
  const { callbackHost, requesterName } = review;
  const requester = requesterName ?? callbackHost ?? "this service";
  // The app picks its own label; the callback host is named beside it whenever the two differ.
  const labelledHost =
    requesterName && callbackHost && requesterName !== callbackHost ? callbackHost : undefined;
  // Without callbacks nothing on the screen names a website, so the line under the heading says
  // so instead; the Authorize button carries either line as its description.
  const describesHost = labelledHost !== undefined || callbackHost === undefined;
  const hostId = useId();

  return (
    <PassportScreen>
      <div className="flex flex-1 flex-col gap-6">
        <div className="flex flex-col gap-3">
          <DisplayHeading
            accent={<FittedRequester>{requester}</FittedRequester>}
            aria-label={`Sign in to ${requester}`}
          >
            Sign in to
          </DisplayHeading>
          {labelledHost ? (
            // Wraps instead of truncating: the end of the host is the part that names its owner.
            <p className="text-sm font-medium leading-5 text-secondary-foreground" id={hostId}>
              Website:{" "}
              <bdi className="font-bold text-foreground [overflow-wrap:anywhere]">
                {labelledHost}
              </bdi>
            </p>
          ) : null}
          {callbackHost === undefined ? (
            <p className="text-sm font-medium leading-5 text-muted-foreground" id={hostId}>
              This request doesn&apos;t name a website. Only continue if you just started signing in
              on another device.
            </p>
          ) : null}
        </div>
        {broadAccessWarning ? (
          <div
            className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm font-medium leading-5 text-foreground"
            role="alert"
          >
            <TriangleAlertIcon className="mt-0.5 text-destructive" />
            <p>{broadAccessWarning}</p>
          </div>
        ) : null}
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
              aria-describedby={describesHost ? hostId : undefined}
              className="w-full"
              disabled={busy || !identity}
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
        {onUseRing && !heldInRing ? (
          <div className="flex flex-col gap-3 border-t border-border pt-6">
            <p className="text-center text-sm text-muted-foreground">
              Or sign in with an identity in Pubky Ring
            </p>
            <Button
              className="w-full"
              disabled={busy}
              onClick={onUseRing}
              size="lg"
              variant="secondary"
            >
              <PubkyBrandIcon />
              Use Pubky Ring
            </Button>
          </div>
        ) : null}
      </div>
    </PassportScreen>
  );
}

const MINIMUM_REQUESTER_FONT_SIZE_PX = 32;

function FittedRequester({ children }: { children: string }) {
  const requesterRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const requester = requesterRef.current;
    const container = requester ? nearestBlockContainer(requester) : null;
    if (!requester || !container) return;

    const fit = () => {
      requester.style.removeProperty("font-size");
      requester.style.whiteSpace = "nowrap";

      const availableWidth = container.clientWidth;
      // `scrollWidth` is 0 while the requester itself is inline (desktop); the bounding box then
      // carries the single-line text width.
      const requiredWidth = Math.max(
        requester.scrollWidth,
        requester.getBoundingClientRect().width,
      );
      if (availableWidth <= 0 || requiredWidth <= availableWidth) return;

      const baseFontSize = Number.parseFloat(window.getComputedStyle(requester).fontSize);
      if (!Number.isFinite(baseFontSize)) return;

      const fittedFontSize = (baseFontSize * availableWidth) / requiredWidth;
      requester.style.fontSize = `${Math.max(MINIMUM_REQUESTER_FONT_SIZE_PX, fittedFontSize)}px`;
      if (fittedFontSize < MINIMUM_REQUESTER_FONT_SIZE_PX) requester.style.whiteSpace = "normal";
    };

    fit();

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(fit);
    resizeObserver?.observe(container);
    let active = true;
    void document.fonts?.ready.then(() => {
      if (active) fit();
    });

    return () => {
      active = false;
      resizeObserver?.disconnect();
    };
  }, [children]);

  return (
    <bdi className="block break-words md:inline" ref={requesterRef}>
      {children}
    </bdi>
  );
}

/**
 * The accent wrapper is `display: inline` on desktop, where `clientWidth` is always 0, so the
 * requester is fitted against the nearest block-level ancestor (the heading) instead.
 */
function nearestBlockContainer(element: HTMLElement): HTMLElement | null {
  let container = element.parentElement;
  while (container && window.getComputedStyle(container).display === "inline") {
    container = container.parentElement;
  }
  return container;
}

function authorizationButtonLabel(
  phase: "review" | "preparing" | "granting" | "completing",
): string {
  if (phase === "preparing") return "Preparing…";
  if (phase === "granting") return "Granting access…";
  if (phase === "completing") return "Completing…";
  return "Authorize";
}

/**
 * The warning for broad capabilities, scaled to the widest one requested: the root (or both
 * halves) reaches all of the person's data, `/pub/` or `/priv/` every app's folder on that side.
 */
function describeBroadAccess(
  capabilities: AuthorizationRequestReview["capabilities"],
): string | undefined {
  const broadPaths = new Set(
    capabilities
      .filter((capability) => capability.scope === "broad")
      .map((capability) => capability.path),
  );
  if (broadPaths.has("/") || (broadPaths.has("/pub/") && broadPaths.has("/priv/"))) {
    return "This app asks for access to all your data, public and private.";
  }
  if (broadPaths.has("/pub/")) {
    return "This app asks for all your public data, including the folders other apps keep for you.";
  }
  if (broadPaths.has("/priv/")) {
    return "This app asks for all your private data, including the folders other apps keep for you.";
  }
  return broadPaths.size > 0
    ? "This app asks for more than its own folder. It could reach the data other apps keep for you."
    : undefined;
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
