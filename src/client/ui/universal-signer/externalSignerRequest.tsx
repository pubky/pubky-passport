"use client";

import type { DeepLinkLauncher } from "@/client/logic/universal-signer/deepLinkLauncher";
import { RingHandoff, type RingHandoffLabels } from "@/client/ui/shared/ringHandoff";

/**
 * An app's sign-in request, Passport's own profile connection and its backup check are all
 * `pubkyauth` links for Ring, so each carries its own labels and none can pass for another.
 */
const LABELS = {
  "app-request": {
    section: "Sign in with your keychain",
    qrCode: "Pubky authorization QR code",
    open: "Open keychain app",
    opening: "Opening your keychain…",
    tooLarge: "This request is too big for a QR code. Open it in your keychain app on this device.",
    unavailable: "This request is no longer available. Return to the app and start a new request.",
  },
  /** An app's legacy cookie request: only Pubky Ring (before 2.0, or 2.0) approves it. */
  "app-request-ring": {
    section: "Sign in with Pubky Ring",
    qrCode: "Pubky authorization QR code",
    open: "Open Pubky Ring",
    tooLarge: "This request is too big for a QR code. Open it in Pubky Ring on this device.",
    unavailable: "This request is no longer available. Return to the app and start a new request.",
  },
  "profile-connection": {
    section: "Keychain connection",
    qrCode: "Keychain connection QR code",
    open: "Open keychain app",
    opening: "Opening your keychain…",
    tooLarge:
      "This connection request is too big for a QR code. Open it in your keychain app on this device.",
    unavailable: "This connection request is no longer available. Start a new request.",
  },
  "backup-verification": {
    section: "Pubky Ring backup check",
    qrCode: "Pubky Ring verification QR code",
    open: "Open Pubky Ring",
    tooLarge:
      "This verification request is too big for a QR code. Open it in Pubky Ring on this device.",
    unavailable: "This verification request is no longer available. Start a new one.",
  },
} as const satisfies Record<string, RingHandoffLabels>;

/** Request content only; the caller owns the page shell and request lifecycle. */
export function ExternalSignerRequest({
  bare = false,
  buttonVariant,
  getAuthorizationUrl,
  launcher,
  openOnReady = false,
  preparing = false,
  purpose = "app-request",
  spent,
}: {
  /** The code or button alone, for a screen that lays out its own keychain card. */
  bare?: boolean;
  /** The phone's button look (see `RingHandoff`). */
  buttonVariant?: "default" | "secondary" | undefined;
  /** A phone follows the link as soon as it exists: the person's press started this hand-off. */
  openOnReady?: boolean;
  /** The request is still being made: a computer shows the code's placeholder meanwhile. */
  preparing?: boolean;
  getAuthorizationUrl: () => string | undefined;
  /**
   * Follows the request's deep link when the caller tracks the launch: one the button that opened
   * Ring already started, or the caller's own, whose state its copy follows.
   */
  launcher?: DeepLinkLauncher | undefined;
  /**
   * An app's request handed to Ring unchanged, Passport's own profile connection, or its check
   * that Pubky Ring holds a key saved here.
   */
  purpose?: keyof typeof LABELS;
  /** The request can no longer be used: its spent code (or a phone's Try again) starts a new one. */
  spent?: { onRetry: () => void } | undefined;
}) {
  return (
    <RingHandoff
      bare={bare}
      buttonVariant={buttonVariant}
      labels={LABELS[purpose]}
      launcher={launcher}
      openOnReady={openOnReady}
      preparing={preparing}
      spent={spent}
      url={preparing || spent ? undefined : getAuthorizationUrl()}
    />
  );
}
