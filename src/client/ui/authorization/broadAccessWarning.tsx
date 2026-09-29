import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { Notice } from "@/client/ui/shared/notice";

/**
 * Warns before a request for broad capabilities goes anywhere, scaled to the widest one requested:
 * the root (or both halves) reaches all of the person's data, `/pub/` or `/priv/` every app's
 * folder on that side. Shown wherever the request can be approved or handed to Pubky Ring. A
 * security risk to stop on, so it uses the red alert surface, not the amber warning tone.
 */
export function BroadAccessWarning({
  capabilities,
}: {
  capabilities: AuthorizationRequestReview["capabilities"];
}) {
  const warning = describeBroadAccess(capabilities);
  return warning ? (
    <Notice className="font-medium" tone="error">
      {warning}
    </Notice>
  ) : null;
}

function describeBroadAccess(
  capabilities: AuthorizationRequestReview["capabilities"],
): string | undefined {
  const broadPaths = new Set(
    capabilities
      .filter((capability) => capability.scope === "broad")
      .map((capability) => capability.path),
  );
  if (broadPaths.has("/") || (broadPaths.has("/pub/") && broadPaths.has("/priv/"))) {
    return "This app asks for access to all your data, public and private.";
  }
  if (broadPaths.has("/pub/")) {
    return "This app asks for all your public data, including the folders other apps keep for you.";
  }
  if (broadPaths.has("/priv/")) {
    return "This app asks for all your private data, including the folders other apps keep for you.";
  }
  return broadPaths.size > 0
    ? "This app asks for more than its own folder. It could reach the data other apps keep for you."
    : undefined;
}
