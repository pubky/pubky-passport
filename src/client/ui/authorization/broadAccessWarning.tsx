import {
  capabilityReach,
  type AuthorizationRequestReview,
} from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { Notice } from "@/client/ui/shared/notice";

/**
 * Warns before a request for broad capabilities goes anywhere, scaled to the widest one requested:
 * the root (or both halves) reaches all of the person's data, `/pub/` or `/priv/` every app's
 * folder on that side. Shown wherever the request can be approved or handed to Pubky Ring. A
 * security risk to stop on, so it uses the red alert surface, not the amber warning tone.
 */
export function BroadAccessWarning({
  capabilities,
  className,
}: {
  capabilities: AuthorizationRequestReview["capabilities"];
  className?: string | undefined;
}) {
  const warning = describeBroadAccess(capabilities);
  return warning ? (
    <Notice className={cn("font-medium", className)} tone="error">
      {warning}
    </Notice>
  ) : null;
}

function describeBroadAccess(
  capabilities: AuthorizationRequestReview["capabilities"],
): string | undefined {
  const broad = capabilities.filter((capability) => capability.scope === "broad");
  const reaches = new Set(broad.map((capability) => capabilityReach(capability.path)));
  if (reaches.has("all") || (reaches.has("public") && reaches.has("private"))) {
    return "This app asks for access to all your data, public and private.";
  }
  if (reaches.has("public")) {
    return "This app asks for all your public data, including the folders other apps keep for you.";
  }
  if (reaches.has("private")) {
    return "This app asks for all your private data, including the folders other apps keep for you.";
  }
  return broad.length > 0
    ? "This app asks for more than its own folder. It could reach the data other apps keep for you."
    : undefined;
}
