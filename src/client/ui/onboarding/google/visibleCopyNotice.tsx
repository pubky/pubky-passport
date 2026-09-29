import type { VisibleRecoveryCopyStatus } from "@/client/logic/google-identity/GoogleIdentityController";
import { Notice } from "@/client/ui/shared/notice";

const COPY = {
  create: {
    skipped:
      "Your identity is ready. No visible recovery copy was created in Google Drive because you did not grant that permission. Download a recovery file from identity management.",
    unconfirmed:
      "Your identity is ready, but Passport could not confirm the visible recovery copy in Google Drive. Download a recovery file from identity management.",
  },
  attach: {
    skipped:
      "Your private Google Drive backup is ready. No visible recovery copy was created in Google Drive because you did not grant that permission. Download a recovery file from identity management.",
    unconfirmed:
      "Your private Google Drive backup is ready, but Passport could not confirm the visible recovery copy in Google Drive. Download a recovery file from identity management.",
  },
} as const;

/**
 * The one warning for a Google backup without a copy the person can see in Drive, said at the
 * same volume after creating an identity with Google and after attaching one to Google. Nothing
 * is shown once the visible copy was created.
 */
export function VisibleCopyNotice({
  className,
  operation,
  status,
}: {
  className?: string;
  operation: keyof typeof COPY;
  status: VisibleRecoveryCopyStatus;
}) {
  if (status !== "skipped" && status !== "unconfirmed") return null;
  return (
    <Notice className={className} tone="warning">
      {COPY[operation][status]}
    </Notice>
  );
}
