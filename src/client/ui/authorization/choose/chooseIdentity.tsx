import { useId } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { IdentityRow } from "@/client/ui/identity-catalog/selection/identityRow";
import { ArrowRightIcon, XIcon } from "@/client/ui/shared/icons";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { Notice } from "@/client/ui/shared/notice";
import { PassportHeaderAction } from "@/client/ui/shared/passportHeaderAction";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { SHORT_WINDOW_GAP } from "@/client/ui/shared/shortWindow";
import { Button } from "@/client/ui/shared/primitives/button";
import { BroadAccessWarning } from "../broadAccessWarning";
import { OtherWaysIn } from "../otherWaysIn";
import { RequestHeading } from "../requestHeading";

/**
 * The first step of a request with saved identities: every one Passport can sign with, and right
 * below the list the other ways to sign in, as the permission review ends; the page flows as a
 * whole and its footer comes last (below 50rem of window height, such as the app's 760px popup,
 * the spacing tightens). Choosing one opens its permission review; Use another
 * identity opens the start page, and Continue with Pubky Ring hands the request to Ring, which is
 * the only way a key held in Ring signs (the caller leaves Ring identities out of the list). With
 * none to list the shell shows the start page instead. A request for broad access is flagged here too, because
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
    <PassportScreen className={cn("gap-6", SHORT_WINDOW_GAP)}>
      <PassportHeaderAction>
        <Button onClick={onCancel} variant="secondary">
          <XIcon /> Cancel
        </Button>
      </PassportHeaderAction>
      <RequestHeading compact review={review} />
      <BroadAccessWarning capabilities={review.capabilities} />
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 text-sm font-medium leading-5 text-muted-foreground">
          <p id={listId}>Choose the identity to sign in with.</p>
          {identities.length > 1 ? (
            // The list announces its own length; the count shows it at a glance.
            <span aria-hidden="true" className="shrink-0">
              {identities.length} identities
            </span>
          ) : null}
        </div>
        <ul
          aria-labelledby={listId}
          className="flex flex-col gap-2"
          // Tailwind's preflight removes list markers, and WebKit then drops the list semantics
          // unless the role is explicit.
          role="list"
        >
          {ordered.map((identity) => {
            const publicKeyZ32 = identity.publicIdentity.publicKeyZ32;
            return (
              <li key={publicKeyZ32}>
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
      <OtherWaysIn onOpenRing={onOpenRing} onUseAnotherIdentity={onUseAnotherIdentity} />
    </PassportScreen>
  );
}
