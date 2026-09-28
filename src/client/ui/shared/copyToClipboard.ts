import { toast } from "sonner";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";

/** What the user is told after a copy attempt. */
export type CopyToasts = {
  copied: string;
  copiedDescription?: string;
  failed: string;
  failedDescription: string;
};

/**
 * Copies `value` and tells the user whether it worked, so a failed copy is never silent.
 * Resolves `false` on failure; the value itself is never logged.
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
    toast.info(toasts.failed, { description: toasts.failedDescription });
    return false;
  }
}
