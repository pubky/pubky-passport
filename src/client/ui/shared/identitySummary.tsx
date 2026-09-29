import type { ReactNode } from "react";

import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { shortPublicKey } from "./formatPublicKey";
import { identityDisplayName, unnamedKey } from "./identityDisplay";
import { KeyCustodyTag } from "./keyCustodyTag";
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
  unnamedKey,
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
  /** The key of an identity without a profile name, which then gets its key-coloured avatar. */
  unnamedKey?: string | undefined;
}) {
  const detailLine = cn(
    "text-xs font-medium tracking-[0.1em] text-muted-foreground",
    detailClassName,
  );
  return (
    <>
      <span className="relative flex shrink-0">
        <Avatar fallback={name} size="sm" src={avatarSrc} unnamedKey={unnamedKey} />
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
 * A saved identity as every list and confirmation shows it: its avatar, its name (or, without a
 * profile, a name made from its key, which then is not repeated underneath), its short key in the
 * key's own case, and where its key lives.
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
  const unnamed = unnamedKey(identity);
  return (
    <IdentitySummary
      attachment={<KeyCustodyTag identity={identity} />}
      attachmentInline={attachmentInline}
      avatarSrc={identity.avatarUrl ?? undefined}
      detail={unnamed ? undefined : shortPublicKey(identity.publicIdentity.publicKeyZ32)}
      detailClassName={detailClassName}
      name={identityDisplayName(identity)}
      unnamedKey={unnamed}
    />
  );
}
