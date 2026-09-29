import { useLayoutEffect, useRef } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";

/** How a request names who asks: the app's own label, and its callback host when that differs. */
export function describeRequester({ callbackHost, requesterName }: AuthorizationRequestReview): {
  requester: string;
  labelledHost: string | undefined;
} {
  return {
    requester: requesterName ?? callbackHost ?? "this service",
    // The app picks its own label; the callback host is named beside it whenever the two differ.
    labelledHost:
      requesterName && callbackHost && requesterName !== callbackHost ? callbackHost : undefined,
  };
}

/** Below this window height a compact heading leaves room for what the screen lists. */
export const SHORT_WINDOW_HEADING =
  "[@media(max-height:50rem)]:text-4xl [@media(max-height:50rem)]:md:text-5xl";

/**
 * "Sign in to {requester}" with what verifies it: the callback host when the app's label differs
 * from it, or a notice when the request names no website at all, so an app-supplied label is never
 * the only identity shown. The line under the heading carries `hostId` for the action it describes.
 * `compact` shrinks the heading in short windows, such as the app's 760px popup.
 */
export function RequestHeading({
  compact = false,
  hostId,
  review,
}: {
  compact?: boolean | undefined;
  hostId?: string | undefined;
  review: AuthorizationRequestReview;
}) {
  const { requester, labelledHost } = describeRequester(review);
  return (
    <div className={cn("flex flex-col gap-3", compact && "[@media(max-height:50rem)]:gap-2")}>
      <DisplayHeading
        accent={<FittedRequester>{requester}</FittedRequester>}
        aria-label={`Sign in to ${requester}`}
        className={compact ? SHORT_WINDOW_HEADING : undefined}
      >
        Sign in to
      </DisplayHeading>
      {labelledHost ? (
        // Wraps instead of truncating: the end of the host is the part that names its owner.
        <p className="text-sm font-medium leading-5 text-secondary-foreground" id={hostId}>
          Website:{" "}
          <bdi className="font-bold text-foreground [overflow-wrap:anywhere]">{labelledHost}</bdi>
        </p>
      ) : null}
      {review.callbackHost === undefined ? (
        <p className="text-sm font-medium leading-5 text-muted-foreground" id={hostId}>
          This request doesn&apos;t name a website. Only continue if you just started signing in on
          another device.
        </p>
      ) : null}
    </div>
  );
}

/** Whether {@link RequestHeading} shows a line that describes the request's origin. */
export function describesHost(review: AuthorizationRequestReview): boolean {
  return describeRequester(review).labelledHost !== undefined || review.callbackHost === undefined;
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
