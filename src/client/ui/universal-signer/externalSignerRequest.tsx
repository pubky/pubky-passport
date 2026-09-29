"use client";

import type { DeepLinkLauncher } from "@/client/logic/universal-signer/deepLinkLauncher";
import { RingHandoff, type RingHandoffLabels } from "@/client/ui/shared/ringHandoff";

/**
 * An app's sign-in request and Passport's own profile connection are both `pubkyauth` links for
 * Ring, so each carries its own labels and neither can pass for the other.
 */
const LABELS = {
  "app-request": {
    section: "Sign in with Pubky Ring",
    qrCode: "Pubky authorization QR code",
    open: "Open Pubky Ring",
    tooLarge: "This request is too big for a QR code. Open it in Pubky Ring on this device.",
    unavailable: "This request is no longer available. Return to the app and start a new request.",
  },
  "profile-connection": {
    section: "Pubky Ring profile connection",
    qrCode: "Pubky Ring profile connection QR code",
    open: "Connect in Pubky Ring",
    tooLarge:
      "This connection request is too big for a QR code. Open it in Pubky Ring on this device.",
    unavailable: "This connection request is no longer available. Start a new request.",
  },
} as const satisfies Record<string, RingHandoffLabels>;

/** Request content only; the caller owns the page shell and request lifecycle. */
export function ExternalSignerRequest({
  getAuthorizationUrl,
  launcher,
  purpose = "app-request",
}: {
  getAuthorizationUrl: () => string | undefined;
  /**
   * Follows the request's deep link when the caller tracks the launch: one the button that opened
   * Ring already started, or the caller's own, whose state its copy follows.
   */
  launcher?: DeepLinkLauncher | undefined;
  /** An app's request handed to Ring unchanged, or Passport's own profile connection. */
  purpose?: keyof typeof LABELS;
}) {
  return <RingHandoff labels={LABELS[purpose]} launcher={launcher} url={getAuthorizationUrl()} />;
}
