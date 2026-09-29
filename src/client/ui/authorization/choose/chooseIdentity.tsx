import Image from "next/image";
import { type FocusEvent, useId } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { IdentityRow } from "@/client/ui/identity-catalog/selection/identityRow";
import { PubkyBrandIcon } from "@/client/ui/shared/brand/pubkyBrandIcon";
import { ArrowRightIcon, UserRoundPlusIcon, XIcon } from "@/client/ui/shared/icons";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { Notice } from "@/client/ui/shared/notice";
import { PassportHeaderAction } from "@/client/ui/shared/passportHeaderAction";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
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
const SHORT_WINDOW_GAP = "[@media(max-height:50rem)]:gap-4";

/**
 * The first step of a request: every saved identity, filling the window above the other ways to
 * sign in. Choosing one opens its permission review. With nothing saved only the other ways are
 * shown, and creating an account is the recommended one. A request for broad access is flagged
 * here too, because Open in Pubky Ring hands it on without the review.
 */
export function ChooseIdentity({
  activePublicKeyZ32,
  identities,
  moreOptionsLabel,
  onCancel,
  onCreateAccount,
  onMoreOptions,
  onOpenRing,
  onSelect,
  review,
  selectionFailed = false,
}: {
  activePublicKeyZ32: string | null;
  /** Shown with the name and avatar kept from earlier reads; this screen reads no profiles. */
  identities: readonly LocalIdentityMetadata[];
  /** Names the other ways in, e.g. Google or an encrypted backup. */
  moreOptionsLabel: string;
  onCancel: () => void;
  onCreateAccount: () => void;
  onMoreOptions: () => void;
  onOpenRing: () => void;
  onSelect: (publicKeyZ32: string) => void;
  review: AuthorizationRequestReview;
  selectionFailed?: boolean;
}) {
  const listId = useId();
  const hasIdentities = identities.length > 0;
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
      {hasIdentities ? (
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
              "-mx-1 flex min-h-24 flex-1 scroll-pt-2 scroll-pb-4 flex-col gap-2 overflow-y-auto overscroll-contain p-1 pb-4 [mask-image:linear-gradient(to_bottom,black_calc(100%-1rem),transparent)]",
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
      ) : (
        <>
          <p className="text-base leading-6 text-muted-foreground">
            Create your Pubky account to sign in, or approve with Pubky Ring.
          </p>
          <div className={cn("flex min-h-0 flex-1 items-center justify-center", FILL_SPACE)}>
            <Image
              alt=""
              aria-hidden="true"
              className="h-full max-h-48 w-auto object-contain"
              height={192}
              src="/illustrations/identity-keys.png"
              width={192}
            />
          </div>
        </>
      )}
      {selectionFailed ? (
        <Notice tone="error">
          Couldn&apos;t choose this identity. Your browser didn&apos;t let Passport save your
          choice. Try again.
        </Notice>
      ) : null}
      <div className="flex flex-col gap-4 [@media(max-height:50rem)]:gap-3">
        {hasIdentities ? (
          <div className="flex items-center gap-4 text-sm font-medium text-muted-foreground">
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
            or
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
          </div>
        ) : null}
        <div className="grid gap-3 min-[30rem]:grid-cols-2">
          <Button
            className="w-full"
            onClick={onCreateAccount}
            size="lg"
            variant={hasIdentities ? "secondary" : "default"}
          >
            <UserRoundPlusIcon /> Create account
          </Button>
          <Button className="w-full" onClick={onOpenRing} size="lg" variant="secondary">
            <PubkyBrandIcon /> Open in Pubky Ring
          </Button>
        </div>
        <Button className="self-center" onClick={onMoreOptions} variant="ghost">
          {moreOptionsLabel}
        </Button>
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
