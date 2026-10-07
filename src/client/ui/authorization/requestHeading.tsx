import { useLayoutEffect, useRef } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { limitCombiningMarks } from "@/libs/text/limitCombiningMarks";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { Notice } from "@/client/ui/shared/notice";
import { SHORT_WINDOW_HEADING } from "@/client/ui/shared/shortWindow";
import { DisplayHeading, TEXT_MEASURE } from "@/client/ui/shared/primitives/typography";
import { useAuthorizationRequester } from "./useAuthorizationRequester";

/**
 * How a request names who asks once a bound opener verified it: the app's own label, and its
 * callback host when that differs. The label is shown with long stacks of combining marks cut (see
 * `limitCombiningMarks`), so it cannot draw over the website line or a warning. A request nobody
 * verified is never named this way (see {@link RequestHeading}).
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

/** The window title of a request whose requester nobody verified. */
export const UNVERIFIED_REQUEST_TITLE = "Sign-in request";

/**
 * The window title for a request. The title labels the app's popup and is kept in history and tab
 * search, where nothing beside it names the website, so it never carries the app's label alone:
 * the callback host goes with it, and a request without one, or one nobody verified, is not named
 * after its label at all.
 */
export function requestWindowTitle(review: AuthorizationRequestReview, verified: boolean): string {
  return requesterWindowTitle("Signing in to", review, verified) ?? UNVERIFIED_REQUEST_TITLE;
}

/**
 * A window title that names the requester after `prefix` ("Signed in to Acme Notes
 * (acme-notes.example)"), under the rule {@link requestWindowTitle} follows. `undefined` for a
 * request without a callback host or not `verified`, whose screens use generic headings instead.
 */
export function requesterWindowTitle(
  prefix: string,
  review: AuthorizationRequestReview,
  verified: boolean,
): string | undefined {
  if (review.callbackHost === undefined || !verified) return undefined;
  const { requester, labelledHost } = describeRequester(review);
  return labelledHost
    ? `${prefix} ${requester} (${labelledHost})`
    : `${prefix} ${review.callbackHost}`;
}

/**
 * "Signing in to {requester}" with the callback host beside an app label that differs from it,
 * once a v2 hello bound this request to its opener. M3: a request nobody verified (no hello, or
 * one that did not bind this request) is a "Sign-in request." that names no website as its
 * requester: the label it gave itself is shown as unverified, and {@link UnverifiedRequestNotice}
 * says to continue only if the person started it. While a hello may still arrive (A39 grace) the
 * heading is that neutral one, without the notice. `warning={false}` leaves the notice to the
 * screen, which shows it above its action; `hostId` goes on the line that names the website or on
 * the notice. `compact` shrinks the heading in short windows, such as the app's 760px popup.
 */
export function RequestHeading({
  compact = false,
  hostId,
  review,
  warning = true,
}: {
  compact?: boolean | undefined;
  hostId?: string | undefined;
  review: AuthorizationRequestReview;
  warning?: boolean | undefined;
}) {
  const asker = useAuthorizationRequester(review);
  const headingClass = compact ? SHORT_WINDOW_HEADING : undefined;
  const gapClass = cn("flex flex-col gap-3", compact && "[@media(max-height:50rem)]:gap-2");
  if (!asker.bound) {
    return (
      <div className={gapClass}>
        {/* One flowing line where it fits, like the Pubky Ring hand-off's heading, so the warning
            and the request's own label still leave Authorize in view in the app's 760px popup. */}
        <DisplayHeading
          accent="request."
          aria-label="Sign-in request."
          className={cn("[&>span]:inline", headingClass)}
          data-window-title={UNVERIFIED_REQUEST_TITLE}
        >
          Sign-in
        </DisplayHeading>
        {review.requesterName ? <UnverifiedName name={review.requesterName} /> : null}
        {warning && asker.unverified ? (
          <UnverifiedRequestNotice className={TEXT_MEASURE} id={hostId} />
        ) : null}
      </div>
    );
  }
  const { requester, labelledHost } = describeRequester(review);
  return (
    <div className={gapClass}>
      <DisplayHeading
        accent={<FittedRequester>{requester}</FittedRequester>}
        aria-label={`Signing in to ${requester}`}
        className={headingClass}
        data-window-title={requestWindowTitle(review, true)}
        // The app's name always starts its own line, so a long one that wraps at a smaller size
        // never shares a line with the larger "Signing in to".
        desktopAccentOnNewLine
      >
        Signing in to
      </DisplayHeading>
      {labelledHost ? (
        // Wraps instead of truncating: the end of the host is the part that names its owner.
        <p className="text-sm font-medium leading-5 text-secondary-foreground" id={hostId}>
          Website:{" "}
          <bdi className="font-bold text-foreground [overflow-wrap:anywhere]">{labelledHost}</bdi>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The label a request gave itself, said to be its own claim. Like the heading's name it is shown
 * with long stacks of combining marks cut, and what its marks draw past their line is clipped.
 */
function UnverifiedName({ name }: { name: string }) {
  return (
    <p className="-my-[0.15em] overflow-hidden py-[0.15em] text-sm font-medium leading-5 text-secondary-foreground">
      Name in the request:{" "}
      <bdi className="font-bold text-foreground [overflow-wrap:anywhere]">
        {limitCombiningMarks(name)}
      </bdi>{" "}
      (unverified)
    </p>
  );
}

/**
 * M3: one short line wherever a request nobody verified can go on (its review above Authorize,
 * the identity list and the Pubky Ring hand-off): Passport cannot tell who sent it. The review's
 * sentence over Authorize then asks to continue only after starting the sign-in.
 */
export function UnverifiedRequestNotice({
  className,
  id,
}: {
  className?: string | undefined;
  id?: string | undefined;
}) {
  return (
    <Notice className={className} id={id} tone="warning">
      Passport can’t confirm who sent this request.
    </Notice>
  );
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
