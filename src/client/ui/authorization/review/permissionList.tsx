import { Fragment, type ReactNode, useId } from "react";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { FolderIcon, TriangleAlertIcon } from "@/client/ui/shared/icons";
import { cn } from "@/client/ui/shared/mergeClassNames";

type Capability = AuthorizationRequestReview["capabilities"][number];

/**
 * The requested capabilities as a list. The card itself stays neutral, so the brand accent keeps
 * marking the action rather than the risk; broad capabilities turn the card border and their own
 * rows red.
 */
function PermissionList({ capabilities }: { capabilities: readonly Capability[] }) {
  const headingId = useId();
  const hasBroadAccess = capabilities.some((capability) => capability.scope === "broad");

  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-[12px] border p-[15px] shadow-xl",
        hasBroadAccess ? "border-destructive/40" : "border-border",
      )}
    >
      <h2
        className="text-xs font-medium uppercase leading-5 tracking-[0.1em] text-muted-foreground"
        id={headingId}
      >
        Requested permissions
      </h2>
      {capabilities.length === 0 ? (
        <p className="text-sm font-medium text-muted-foreground">No data permissions requested.</p>
      ) : (
        // Tailwind's preflight removes list markers, and WebKit then drops the list semantics
        // unless the role is explicit.
        <ul aria-labelledby={headingId} className="flex flex-col gap-2" role="list">
          {capabilities.map((capability, index) => (
            <PermissionRow
              capability={capability}
              key={`${capability.path}:${capability.read}:${capability.write}:${index}`}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PermissionRow({ capability }: { capability: Capability }) {
  const broad = capability.scope === "broad";

  return (
    <li className="flex items-start gap-2">
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center",
          broad && "text-destructive",
        )}
      >
        {broad ? <TriangleAlertIcon /> : <FolderIcon />}
      </span>
      {broad ? <span className="sr-only">Broad access: </span> : null}
      <bdi
        className={cn(
          "min-w-0 flex-1 text-sm font-medium leading-5 [overflow-wrap:anywhere]",
          broad && "text-destructive",
        )}
        dir="ltr"
      >
        {withPathBreaks(capability.path)}
      </bdi>
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
