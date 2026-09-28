import { useLayoutEffect, useRef } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { CheckIcon, XIcon } from "@/client/ui/shared/icons";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { SelectedIdentity } from "@/client/ui/shared/selectedIdentity";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";
import { PermissionList, PermissionRow } from "./permissionList";

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
  const hasBroadAccess = review.capabilities.some((capability) => capability.scope === "broad");
  const requester = review.requesterName ?? review.callbackHost ?? "this service";

  return (
    <PassportScreen>
      <div className="flex flex-1 flex-col gap-6">
        <DisplayHeading
          accent={<FittedRequester>{requester}</FittedRequester>}
          aria-label={`Sign in to ${requester}`}
        >
          Sign in to
        </DisplayHeading>
        {hasBroadAccess ? (
          <p
            className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm font-medium leading-5 text-foreground"
            role="alert"
          >
            This request includes broad access that is not limited to one app namespace.
          </p>
        ) : null}
        <PermissionList>
          {review.capabilities.length === 0 ? (
            <p className="text-sm font-medium text-muted-foreground">
              No data permissions requested.
            </p>
          ) : (
            review.capabilities.map((capability, index) => (
              <PermissionRow
                access={formatAccess(capability)}
                key={`${capability.path}:${capability.read}:${capability.write}:${index}`}
                path={capability.path}
              />
            ))
          )}
        </PermissionList>
        <SelectedIdentity identity={identity} onSwitch={onSwitch} disabled={busy} />
        {heldInRing ? (
          <p className="text-sm font-medium leading-5 text-muted-foreground">
            This identity is held in Pubky Ring. You choose the identity to sign in with in Ring.
          </p>
        ) : null}
        <p className="break-words text-sm font-medium leading-5 text-muted-foreground">
          Make sure you trust this service, browser, or device before authorizing with your pubky.{" "}
          <strong className="font-bold text-foreground">
            {describeAuthorizationEffect(review.capabilities, requester)}
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

function formatAccess(capability: AuthorizationRequestReview["capabilities"][number]): string {
  if (capability.read && capability.write) return "Read,write";
  if (capability.write) return "Write";
  return "Read";
}

export { AuthorizationReview };
