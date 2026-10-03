import type { VisibleRecoveryCopyStatus } from "@/client/logic/google-identity/GoogleIdentityController";
import { Notice } from "@/client/ui/shared/notice";

/** The copy only makes the Drive backup easy to find; the backup itself works without it. */
const COPY = {
  // Both screens say the Drive backup is stored just above, so this note adds only what is missing.
  skipped:
    "No copy in your “Pubky Passport” Drive folder. To keep a copy outside Google, download a recovery file in Manage identity.",
  unconfirmed:
    "Passport couldn’t confirm the copy in your “Pubky Passport” Drive folder. Your Google Drive backup still works.",
} as const;

/**
 * The one note for a Google backup without its copy in the person's “Pubky Passport” Drive folder,
 * said the same way and at the same volume after creating an identity with Google and after
 * attaching one to Google. Nothing is shown once the copy was created.
 */
export function VisibleCopyNotice({
  className,
  status,
}: {
  className?: string;
  status: VisibleRecoveryCopyStatus;
}) {
  if (status !== "skipped" && status !== "unconfirmed") return null;
  return (
    <Notice className={className} tone="warning">
      {COPY[status]}
    </Notice>
  );
}
