import { toast } from "sonner";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";

/** What the user is told after a copy attempt. */
export type CopyToasts = {
  copied: string;
  copiedDescription?: string;
  /** The copied value, cut to its start, under the confirmation (a public key, never a secret). */
  showValue?: boolean;
  failed: string;
  failedDescription: string;
};

/** What copying a pubky says, wherever one is shown. */
export const PUBKY_COPY_TOASTS = {
  copied: "Pubky copied to clipboard",
  showValue: true,
  failed: "Could not copy pubky",
  failedDescription: "Select and copy your pubky manually.",
} as const satisfies CopyToasts;

/** What copying a homeserver's key says, wherever one is shown. */
export const HOMESERVER_COPY_TOASTS = {
  copied: "Homeserver copied",
  failed: "Could not copy homeserver",
  failedDescription: "Select and copy the homeserver manually.",
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
    const description =
      toasts.copiedDescription ?? (toasts.showValue ? shortValue(value) : undefined);
    // A copy that worked is a success, as pubky.app confirms it.
    if (description) toast.success(toasts.copied, { description });
    else toast.success(toasts.copied);
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

/**
 * The start of a long value, as pubky.app's copy toast shows a pubky: 28 characters and "…", which
 * stays on one line in a phone's toast.
 */
function shortValue(value: string): string {
  return value.length > 28 ? `${value.slice(0, 28)}…` : value;
}
