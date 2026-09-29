import { Fragment, type ReactNode, useId, useState } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { FolderIcon, TriangleAlertIcon } from "@/client/ui/shared/icons";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { Button } from "@/client/ui/shared/primitives/button";
import { describeCapabilityPath, isOwnPublicFolder } from "./describeCapabilityPath";

type Capability = AuthorizationRequestReview["capabilities"][number];

/** Longer lists start collapsed, so the actions stay near the fold. */
const COLLAPSE_ABOVE = 6;
/** Rows a collapsed list shows at least: every row it may not fold, then its own folder's. */
const COLLAPSED_ROWS = 5;

/**
 * The requested capabilities as a list, each with a plain title over its exact path. The card
 * itself stays neutral, so the brand accent keeps marking the action rather than the risk; broad
 * capabilities turn the card border and their own rows red. A long list folds away only rows in
 * the requesting app's own public folder (`/pub/<callbackHost>/`), so which rows stay in view
 * never depends on the order the app sent them: broad rows, the Pubky App's folders, private
 * folders and other apps' folders are always shown, and a request without a website never folds.
 */
function PermissionList({
  callbackHost,
  capabilities,
}: {
  callbackHost?: string | undefined;
  capabilities: readonly Capability[];
}) {
  const headingId = useId();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const broadRows = capabilities.filter((capability) => capability.scope === "broad");
  const foldable = capabilities.filter((capability) =>
    isOwnPublicFolder(capability.path, callbackHost),
  );
  const pinned = capabilities.filter(
    (capability) => !isOwnPublicFolder(capability.path, callbackHost),
  );
  const collapsedRows = Math.max(pinned.length, COLLAPSED_ROWS);
  const collapsible = capabilities.length > COLLAPSE_ABOVE && capabilities.length > collapsedRows;
  // A long list leads with the rows it never folds, broad ones first, in both states, so expanding
  // never moves a row.
  const rows = collapsible
    ? [...broadRows, ...pinned.filter((capability) => capability.scope !== "broad"), ...foldable]
    : capabilities;
  const shown = collapsible && !expanded ? rows.slice(0, collapsedRows) : rows;
  const hidden = capabilities.length - collapsedRows;

  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-[12px] border p-[15px] shadow-xl",
        broadRows.length > 0 ? "border-destructive-text/40" : "border-border",
      )}
    >
      <h2
        className="text-xs font-medium uppercase leading-5 tracking-[0.1em] text-muted-foreground"
        id={headingId}
      >
        Requested permissions{collapsible ? ` (${capabilities.length})` : null}
      </h2>
      {capabilities.length === 0 ? (
        <p className="text-sm font-medium text-muted-foreground">No data permissions requested.</p>
      ) : (
        // Tailwind's preflight removes list markers, and WebKit then drops the list semantics
        // unless the role is explicit.
        <ul aria-labelledby={headingId} className="flex flex-col gap-3" id={listId} role="list">
          {shown.map((capability, index) => (
            <PermissionRow
              callbackHost={callbackHost}
              capability={capability}
              key={`${capability.path}:${capability.read}:${capability.write}:${index}`}
            />
          ))}
        </ul>
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
    </section>
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
  const title = describeCapabilityPath(capability.path, callbackHost);

  return (
    <li className="flex items-start gap-2">
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center",
          broad && "text-destructive-text",
        )}
      >
        {broad ? <TriangleAlertIcon /> : <FolderIcon />}
      </span>
      {broad ? <span className="sr-only">Broad access: </span> : null}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm font-medium leading-5 [overflow-wrap:anywhere]",
            broad && "text-destructive-text",
          )}
        >
          {title.text}
          {title.folder === undefined ? null : (
            <>
              {": “"}
              <bdi dir="ltr">{withPathBreaks(title.folder)}</bdi>
              {"”"}
            </>
          )}
        </span>
        <span className="sr-only">, </span>
        <bdi
          className="block font-mono text-xs leading-4 text-muted-foreground [overflow-wrap:anywhere]"
          dir="ltr"
        >
          {withPathBreaks(capability.path)}
        </bdi>
      </span>
      <span className="shrink-0 rounded-full border border-input px-2 text-xs font-medium leading-[18px] text-secondary-foreground">
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
