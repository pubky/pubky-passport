import { toast } from "sonner";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";

/** What the user is told after a copy attempt. */
export type CopyToasts = {
  copied: string;
  copiedDescription?: string;
  failed: string;
  failedDescription: string;
};

/** What copying a pubky says, wherever one is shown. */
export const PUBKY_COPY_TOASTS = {
  copied: "Pubky copied to clipboard",
  failed: "Could not copy pubky",
  failedDescription: "Select and copy your pubky manually.",
} as const satisfies CopyToasts;

/** A failed copy asks the person to copy by hand, so it stays until closed or read. */
const FAILED_COPY_DURATION_MS = 10_000;

/**
 * Copies `value` and tells the user whether it worked, so a failed copy is never silent: a failure
 * is an error toast that stays longer and can be closed. Resolves `false` on failure; the value
 * itself is never logged.
 */
export async function copyToClipboard(value: string, toasts: CopyToasts): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    if (toasts.copiedDescription)
      toast.info(toasts.copied, { description: toasts.copiedDescription });
    else toast.info(toasts.copied);
    return true;
  } catch (e) {
    LOGGER.info("clipboard.copy.failed", safeErrorLogFields(e));
    toast.error(toasts.failed, {
      closeButton: true,
      description: toasts.failedDescription,
      duration: FAILED_COPY_DURATION_MS,
    });
    return false;
  }
}
