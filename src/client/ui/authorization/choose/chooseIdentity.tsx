import { type FocusEvent, useId } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { IdentityRow } from "@/client/ui/identity-catalog/selection/identityRow";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { ArrowRightIcon, UserRoundPlusIcon, XIcon } from "@/client/ui/shared/icons";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { Notice } from "@/client/ui/shared/notice";
import { OrDivider } from "@/client/ui/shared/orDivider";
import { PassportHeaderAction } from "@/client/ui/shared/passportHeaderAction";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { SHORT_WINDOW_GAP } from "@/client/ui/shared/shortWindow";
import { Button } from "@/client/ui/shared/primitives/button";
import { BroadAccessWarning } from "../broadAccessWarning";
import { RequestHeading } from "../requestHeading";

/**
 * From 36rem of window height the screen fills the window below the header: the list takes the
 * space left and scrolls inside it, so the other ways in stay in view (`contain: size` keeps the
 * list's rows out of the screen's minimum height, which `min-h-min` keeps above the rest of the
 * content). In shorter windows, e.g. a zoomed popup, the page flows and scrolls as a whole. Below
 * 50rem, such as the app's 760px popup, the spacing tightens so the list shows more rows.
 */
const FILL_WINDOW =
  "[@media(min-height:36rem)]:h-[calc(100svh-var(--passport-header-height)-var(--passport-context-band-height))] min-h-min";
const FILL_SPACE = "[@media(min-height:36rem)]:[contain:size]";

/**
 * The first step of a request with saved identities: every one of them, filling the window above
 * the other ways to sign in. Choosing one opens its permission review; Use another identity opens
 * the start page, and Continue with Pubky Ring hands the request to Ring. With nothing saved the
 * shell shows the start page instead. A request for broad access is flagged here too, because
 * Continue with Pubky Ring hands it on without the review.
 */
export function ChooseIdentity({
  activePublicKeyZ32,
  identities,
  onCancel,
  onOpenRing,
  onSelect,
  onUseAnotherIdentity,
  review,
  selectionFailed = false,
}: {
  activePublicKeyZ32: string | null;
  /** Shown with the name and avatar kept from earlier reads; this screen reads no profiles. */
  identities: readonly LocalIdentityMetadata[];
  onCancel: () => void;
  onOpenRing: () => void;
  onSelect: (publicKeyZ32: string) => void;
  /** Opens the start page: create an account, Google, a recovery file or Pubky Ring. */
  onUseAnotherIdentity: () => void;
  review: AuthorizationRequestReview;
  selectionFailed?: boolean;
}) {
  const listId = useId();
  // The identity used last comes first; nothing is chosen for this request yet.
  const ordered = [
    ...identities.filter(
      ({ publicIdentity }) => publicIdentity.publicKeyZ32 === activePublicKeyZ32,
    ),
    ...identities.filter(
      ({ publicIdentity }) => publicIdentity.publicKeyZ32 !== activePublicKeyZ32,
    ),
  ];

  return (
    <PassportScreen className={cn("gap-6", SHORT_WINDOW_GAP, FILL_WINDOW)}>
      <PassportHeaderAction>
        <Button onClick={onCancel} variant="secondary">
          <XIcon /> Cancel
        </Button>
      </PassportHeaderAction>
      <RequestHeading compact review={review} />
      <BroadAccessWarning capabilities={review.capabilities} />
      <div className={cn("flex min-h-0 flex-1 flex-col gap-2", FILL_SPACE)}>
        <div className="flex items-baseline justify-between gap-3 text-sm font-medium leading-5 text-muted-foreground">
          <p id={listId}>Choose the identity to sign in with.</p>
          {identities.length > 1 ? (
            // The list announces its own length; the count shows how far the list scrolls.
            <span aria-hidden="true" className="shrink-0">
              {identities.length} identities
            </span>
          ) : null}
        </div>
        <ul
          aria-labelledby={listId}
          className={cn(
            // The bottom fades, so a row cut by the edge reads as more to scroll to; the scroll
            // padding keeps a focused row clear of the fade.
            "-mx-1 flex min-h-24 flex-1 scroll-pt-2 scroll-pb-8 flex-col gap-2 overflow-y-auto overscroll-contain p-1 pb-8 [mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]",
            FILL_SPACE,
          )}
          onFocus={revealKeyboardFocus}
          // Tailwind's preflight removes list markers, and WebKit then drops the list semantics
          // unless the role is explicit.
          role="list"
        >
          {ordered.map((identity) => {
            const publicKeyZ32 = identity.publicIdentity.publicKeyZ32;
            return (
              <li className="shrink-0" key={publicKeyZ32}>
                <IdentityRow
                  identity={identity}
                  onClick={() => onSelect(publicKeyZ32)}
                  trailing={<ArrowRightIcon className="shrink-0 text-muted-foreground" />}
                />
              </li>
            );
          })}
        </ul>
      </div>
      {selectionFailed ? (
        <Notice tone="error">
          Couldn&apos;t choose this identity. Your browser didn&apos;t let Passport save your
          choice. Try again.
        </Notice>
      ) : null}
      <div className="flex flex-col gap-4 [@media(max-height:50rem)]:gap-3">
        <OrDivider />
        {/* A narrower inset keeps "Continue with Pubky Ring" on one line beside Use another
            identity in the app's 520px popup, so the list above keeps its rows. */}
        <div className="grid gap-3 min-[30rem]:grid-cols-2">
          <Button
            className="w-full px-4"
            onClick={onUseAnotherIdentity}
            size="lg"
            variant="secondary"
          >
            <UserRoundPlusIcon /> Use another identity
          </Button>
          <Button className="w-full px-4" onClick={onOpenRing} size="lg" variant="secondary">
            <PubkyBrandIcon /> Continue with Pubky Ring
          </Button>
        </div>
      </div>
    </PassportScreen>
  );
}

/**
 * Brings a row reached by keyboard fully into the list's view, inside its scroll padding: some
 * browsers (Firefox) leave a partly visible row where it is, under the fade. Pointer focus is left
 * alone, so a pressed row never moves under the pointer.
 */
function revealKeyboardFocus(event: FocusEvent<HTMLUListElement>) {
  const row = event.target;
  try {
    if (row.matches(":focus-visible")) row.scrollIntoView?.({ block: "nearest" });
  } catch {
    // An engine without :focus-visible keeps its own focus scrolling.
  }
}
