import type { ReactNode } from "react";

import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { shortPublicKey } from "./formatPublicKey";
import { identityDisplayName, profileName } from "./identityDisplay";
import { hasKeyCustodyTag, KeyCustodyTag } from "./keyCustodyTag";
import { cn } from "./mergeClassNames";
import { Avatar } from "./primitives/avatar";

export function IdentitySummary({
  attachment,
  attachmentInline = false,
  avatarSrc,
  badge,
  detail,
  detailClassName,
  name,
  profileName,
  publicKey,
}: {
  /** Rendered under the detail line, e.g. an attached Google account. */
  attachment?: ReactNode | undefined;
  /** Puts the attachment on the detail line, wrapping under it only when the row is narrow. */
  attachmentInline?: boolean | undefined;
  avatarSrc?: string | undefined;
  badge?: ReactNode | undefined;
  /** A second line, such as the short key; omitted when the name already carries it. */
  detail?: string | undefined;
  detailClassName?: string | undefined;
  name: string;
  /** The identity's profile name, for the initial its face shows without a picture. */
  profileName?: string | undefined;
  /**
   * The identity's key: without a picture it gets pubky.app's face for it. Without one (a Google
   * account) the name's initials stand in.
   */
  publicKey?: string | undefined;
}) {
  const detailLine = cn(
    "text-xs font-medium tracking-[0.1em] text-muted-foreground",
    detailClassName,
  );
  return (
    <>
      <span className="relative flex shrink-0">
        <Avatar
          {...(publicKey ? { publicKey, profileName } : { fallback: name })}
          size="sm"
          src={avatarSrc}
        />
        {badge ? (
          <span className="absolute bottom-px right-px flex size-4 items-center justify-center drop-shadow-xl">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate leading-6">{name}</strong>
        {attachment && attachmentInline ? (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {detail ? <span className={cn("shrink-0", detailLine)}>{detail}</span> : null}
            <span className="flex min-w-0">{attachment}</span>
          </span>
        ) : (
          <>
            {detail ? <span className={cn("block truncate", detailLine)}>{detail}</span> : null}
            {attachment ? <span className="mt-1 flex min-w-0">{attachment}</span> : null}
          </>
        )}
      </span>
    </>
  );
}

/**
 * A saved identity as every list and confirmation shows it: its avatar (its picture, else
 * pubky.app's face for its key), its name (or, without a profile, a name made from its key, which
 * then is not repeated underneath), its short key in the key's own case, and where its key lives
 * when that is Pubky Ring or a Google account.
 */
export function SavedIdentitySummary({
  attachmentInline,
  detailClassName,
  identity,
}: {
  attachmentInline?: boolean | undefined;
  detailClassName?: string | undefined;
  identity: LocalIdentityMetadata;
}) {
  const publicKey = identity.publicIdentity.publicKeyZ32;
  const named = profileName(identity);
  return (
    <IdentitySummary
      attachment={hasKeyCustodyTag(identity) ? <KeyCustodyTag identity={identity} /> : undefined}
      attachmentInline={attachmentInline}
      avatarSrc={identity.avatarUrl ?? undefined}
      detail={named ? shortPublicKey(publicKey) : undefined}
      detailClassName={detailClassName}
      name={identityDisplayName(identity)}
      profileName={named}
      publicKey={publicKey}
    />
  );
}
