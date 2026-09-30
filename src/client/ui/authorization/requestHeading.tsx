import { useLayoutEffect, useRef } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { limitCombiningMarks } from "@/libs/text/limitCombiningMarks";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { SHORT_WINDOW_HEADING } from "@/client/ui/shared/shortWindow";
import { DisplayHeading } from "@/client/ui/shared/primitives/typography";

/**
 * How a request names who asks: the app's own label, and its callback host when that differs. The
 * label is shown with long stacks of combining marks cut (see `limitCombiningMarks`), so it cannot
 * draw over the website line or a warning.
 */
export function describeRequester({ callbackHost, requesterName }: AuthorizationRequestReview): {
  requester: string;
  labelledHost: string | undefined;
} {
  return {
    requester:
      (requesterName === undefined ? undefined : limitCombiningMarks(requesterName)) ??
      callbackHost ??
      "this service",
    // The app picks its own label; the callback host is named beside it whenever the two differ.
    labelledHost:
      requesterName && callbackHost && requesterName !== callbackHost ? callbackHost : undefined,
  };
}

/**
 * The window title for a request. The title labels the app's popup and is kept in history and tab
 * search, where nothing beside it names the website, so it never carries the app's label alone:
 * the callback host goes with it, and a request without one is not named after its label at all.
 */
export function requestWindowTitle(review: AuthorizationRequestReview): string {
  return requesterWindowTitle("Sign in to", review) ?? "Sign-in request";
}

/**
 * A window title that names the requester after `prefix` ("Signed in to Acme Notes
 * (acme-notes.example)"), under the rule {@link requestWindowTitle} follows. `undefined` for a
 * request without a callback host, whose screens use generic headings instead.
 */
export function requesterWindowTitle(
  prefix: string,
  review: AuthorizationRequestReview,
): string | undefined {
  if (review.callbackHost === undefined) return undefined;
  const { requester, labelledHost } = describeRequester(review);
  return labelledHost
    ? `${prefix} ${requester} (${labelledHost})`
    : `${prefix} ${review.callbackHost}`;
}

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
        data-window-title={requestWindowTitle(review)}
        // The app's name always starts its own line, so a long one that wraps at a smaller size
        // never shares a line with the larger "Sign in to".
        desktopAccentOnNewLine
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
      {review.callbackHost === undefined ? <NoWebsiteNotice id={hostId} /> : null}
    </div>
  );
}

/**
 * Says a request names no website, so the app's own label is not taken as who asks. Shown under
 * the request's heading and on the Pubky Ring hand-off, wherever such a request can go on.
 */
export function NoWebsiteNotice({ id }: { id?: string | undefined }) {
  return (
    <p className="text-sm font-medium leading-5 text-muted-foreground" id={id}>
      This request doesn&apos;t name a website. Only continue if you just started signing in on
      another device.
    </p>
  );
}

/** Whether {@link RequestHeading} shows a line that describes the request's origin. */
export function describesHost(review: AuthorizationRequestReview): boolean {
  return describeRequester(review).labelledHost !== undefined || review.callbackHost === undefined;
}

const MINIMUM_REQUESTER_FONT_SIZE_PX = 32;
/** The line height of a requester shrunk below the heading's size, which keeps its own leading. */
const FITTED_LINE_HEIGHT = "1.1";

/**
 * An app-supplied name as a heading accent: shrunk to fit the column down to 32px, then wrapped,
 * never cut, since cutting could hide words of the name. Whatever its marks draw more than 0.15em
 * above or below its lines is clipped, so it never covers the lines around the heading.
 */
export function FittedRequester({ children }: { children: string }) {
  const requesterRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const requester = requesterRef.current;
    const container = requester ? nearestBlockContainer(requester) : null;
    if (!requester || !container) return;

    const fit = () => {
      requester.style.removeProperty("font-size");
      requester.style.removeProperty("line-height");
      requester.style.whiteSpace = "nowrap";

      const availableWidth = container.clientWidth;
      // An inline requester (an accent that shares its line) has no `scrollWidth`; its bounding
      // box then carries the single-line text width.
      const requiredWidth = Math.max(
        requester.scrollWidth,
        requester.getBoundingClientRect().width,
      );
      if (availableWidth <= 0 || requiredWidth <= availableWidth) return;

      const baseFontSize = Number.parseFloat(window.getComputedStyle(requester).fontSize);
      if (!Number.isFinite(baseFontSize)) return;

      const fittedFontSize = (baseFontSize * availableWidth) / requiredWidth;
      requester.style.fontSize = `${Math.max(MINIMUM_REQUESTER_FONT_SIZE_PX, fittedFontSize)}px`;
      requester.style.lineHeight = FITTED_LINE_HEIGHT;
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
    <bdi className="-my-[0.15em] block overflow-hidden break-words py-[0.15em]" ref={requesterRef}>
      {children}
    </bdi>
  );
}

/**
 * An accent wrapper that shares the heading's line on desktop is `display: inline`, where
 * `clientWidth` is always 0, so the requester is fitted against the nearest block-level ancestor
 * (the heading) instead.
 */
function nearestBlockContainer(element: HTMLElement): HTMLElement | null {
  let container = element.parentElement;
  while (container && window.getComputedStyle(container).display === "inline") {
    container = container.parentElement;
  }
  return container;
}
