import { Fragment, type ReactNode, useId, useState } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { limitCombiningMarks } from "@/libs/text/limitCombiningMarks";
import { FolderIcon, GlobeIcon, LockIcon, TriangleAlertIcon } from "@/client/ui/shared/icons";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { Button } from "@/client/ui/shared/primitives/button";
import { describeCapabilityPath, isOwnPublicFolder } from "./describeCapabilityPath";

type Capability = AuthorizationRequestReview["capabilities"][number];

/** Longer lists start collapsed, so the actions stay near the fold. */
const COLLAPSE_ABOVE = 6;
/** Rows a collapsed list shows at least: every row it may not fold, then its own folder's. */
const COLLAPSED_ROWS = 5;

/**
 * How much a row exposes, most first: broad access, then private data (`/priv/`, visible only to
 * the person and the apps they allow), then public data (`/pub/`, which anyone can already see).
 */
function sensitivity(capability: Capability): number {
  if (capability.scope === "broad") return 0;
  return capability.path.startsWith("/priv/") ? 1 : 2;
}

/**
 * The requested capabilities, ranked by what is at stake. Rows are grouped under "Can read and
 * change" (any write) above "Can only read", each group most sensitive first; a write row carries
 * a strong badge, a read-only one a quiet outline. Private rows carry a lock and full-strength
 * text, public rows a globe and muted text, and one line under the list says why. Each row keeps
 * its plain title over its exact path. Broad capabilities turn the card border and their own rows
 * red. A long list folds away only rows in the requesting app's own public folder
 * (`/pub/<callbackHost>/`), so which rows stay in view never depends on the order the app sent
 * them: broad rows, the Pubky App's folders, private folders and other apps' folders are always
 * shown, and a request without a website never folds.
 */
function PermissionList({
  callbackHost,
  capabilities,
}: {
  callbackHost?: string | undefined;
  capabilities: readonly Capability[];
}) {
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const broad = capabilities.some((capability) => capability.scope === "broad");
  const foldable = (capability: Capability) => isOwnPublicFolder(capability.path, callbackHost);
  const pinnedCount = capabilities.filter((capability) => !foldable(capability)).length;
  const collapsedRows = Math.max(pinnedCount, COLLAPSED_ROWS);
  const collapsible = capabilities.length > COLLAPSE_ABOVE && capabilities.length > collapsedRows;
  // Most sensitive first; the app's own public folder last, where folding takes it from.
  const ranked = capabilities
    .map((capability, order) => ({ capability, order }))
    .sort(
      (a, b) =>
        sensitivity(a.capability) - sensitivity(b.capability) ||
        Number(foldable(a.capability)) - Number(foldable(b.capability)) ||
        a.order - b.order,
    );
  // Folded, the list keeps every row it may not fold and as many of the others as fit.
  const foldedAway = new Set(
    collapsible && !expanded
      ? ranked
          .filter(({ capability }) => foldable(capability))
          .slice(collapsedRows - pinnedCount)
          .map(({ order }) => order)
      : [],
  );
  const shown = ranked.filter(({ order }) => !foldedAway.has(order));
  const groups = [
    { label: "Can read and change", rows: shown.filter(({ capability }) => capability.write) },
    { label: "Can only read", rows: shown.filter(({ capability }) => !capability.write) },
  ].filter((group) => group.rows.length > 0);
  const hidden = capabilities.length - collapsedRows;
  // The line explains the difference between the rows, so it shows only where both kinds are
  // asked for; a short list then still fits the app's 760px pop-up with its actions.
  const namesPrivacy =
    capabilities.some((capability) => capability.path.startsWith("/priv/")) &&
    capabilities.some((capability) => capability.path.startsWith("/pub/"));

  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-[12px] border p-[15px] shadow-xl",
        broad ? "border-destructive-text/40" : "border-border",
      )}
    >
      <h2 className="text-xs font-medium uppercase leading-5 tracking-[0.1em] text-muted-foreground">
        Requested permissions{collapsible ? ` (${capabilities.length})` : null}
      </h2>
      {capabilities.length === 0 ? (
        <p className="text-sm font-medium text-muted-foreground">No data permissions requested.</p>
      ) : (
        <div className="flex flex-col gap-4" id={listId}>
          {groups.map((group) => (
            <PermissionGroup
              callbackHost={callbackHost}
              capabilities={group.rows.map(({ capability }) => capability)}
              key={group.label}
              label={group.label}
              rowKeys={group.rows.map(({ order }) => order)}
            />
          ))}
        </div>
      )}
      {collapsible ? (
        <Button
          aria-controls={listId}
          aria-expanded={expanded}
          className="self-start"
          onClick={() => setExpanded((open) => !open)}
          variant="link"
        >
          {expanded ? "Show fewer permissions" : `Show ${hidden} more of this app's own data`}
        </Button>
      ) : null}
      {namesPrivacy ? (
        <p className="text-xs leading-4 text-muted-foreground">
          Anyone can already see public data; private data is only visible to you and the apps you
          allow.
        </p>
      ) : null}
    </section>
  );
}

/** One group of rows under its plain heading, the rows a list of their own. */
function PermissionGroup({
  callbackHost,
  capabilities,
  label,
  rowKeys,
}: {
  callbackHost: string | undefined;
  capabilities: readonly Capability[];
  label: string;
  rowKeys: readonly number[];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold leading-5 text-foreground" id={id}>
        {label}
      </h3>
      {/* Tailwind's preflight removes list markers, and WebKit then drops the list semantics
          unless the role is explicit. */}
      <ul aria-labelledby={id} className="flex flex-col gap-3" role="list">
        {capabilities.map((capability, index) => (
          <PermissionRow callbackHost={callbackHost} capability={capability} key={rowKeys[index]} />
        ))}
      </ul>
    </div>
  );
}

function PermissionRow({
  callbackHost,
  capability,
}: {
  callbackHost: string | undefined;
  capability: Capability;
}) {
  const broad = capability.scope === "broad";
  const isPrivate = capability.path.startsWith("/priv/");
  const isPublic = capability.path.startsWith("/pub/");
  const title = describeCapabilityPath(capability.path, callbackHost);
  // Shown with long stacks of combining marks cut, and clipped to its own lines, so a path cannot
  // draw over the warning or the rows around it. The request keeps the path it signs.
  const path = limitCombiningMarks(capability.path);

  return (
    <li className="flex items-start gap-2">
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center",
          broad ? "text-destructive-text" : isPublic ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {broad ? (
          <TriangleAlertIcon />
        ) : isPrivate ? (
          <LockIcon />
        ) : isPublic ? (
          <GlobeIcon />
        ) : (
          <FolderIcon />
        )}
      </span>
      {broad ? <span className="sr-only">Broad access: </span> : null}
      {!broad && isPrivate ? <span className="sr-only">Private: </span> : null}
      {!broad && isPublic ? <span className="sr-only">Public: </span> : null}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block overflow-hidden text-sm font-medium leading-5 [overflow-wrap:anywhere]",
            broad
              ? "text-destructive-text"
              : isPublic
                ? "text-secondary-foreground"
                : "text-foreground",
          )}
        >
          {title.text}
          {title.folder === undefined ? null : (
            <>
              {": “"}
              <bdi dir="ltr">{withPathBreaks(limitCombiningMarks(title.folder))}</bdi>
              {"”"}
            </>
          )}
        </span>
        {title.description === undefined ? null : (
          <>
            <span className="sr-only">, </span>
            <span
              className={cn(
                "block text-xs leading-4",
                isPublic ? "text-muted-foreground" : "text-secondary-foreground",
              )}
            >
              {title.description}
            </span>
          </>
        )}
        <span className="sr-only">, </span>
        <bdi
          className="block overflow-hidden font-mono text-xs leading-4 text-muted-foreground [overflow-wrap:anywhere]"
          dir="ltr"
        >
          {withPathBreaks(path)}
        </bdi>
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full border px-2 text-xs leading-[18px]",
          // A row that can change data is the one to weigh: a filled badge; reading, a quiet one.
          capability.write
            ? "border-brand bg-brand/20 font-bold text-brand"
            : "border-input font-medium text-muted-foreground",
        )}
      >
        <span className="sr-only">, </span>
        {formatAccess(capability)}
      </span>
    </li>
  );
}

/** Lets a long path wrap after a "/" or "." before it has to break inside a name. */
function withPathBreaks(path: string): ReactNode {
  return path.split(/(?<=[/.])/u).map((segment, index) => (
    // Segments repeat ("a/a/"), and the path never changes while it is shown.
    <Fragment key={index}>
      {index > 0 ? <wbr /> : null}
      {segment}
    </Fragment>
  ));
}

function formatAccess(capability: Capability): string {
  if (capability.read && capability.write) return "Read & write";
  if (capability.write) return "Write only";
  return "Read only";
}

export { PermissionList };
