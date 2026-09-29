import "client-only";

import type {
  RingAnswerLook,
  RingAnswerWatchOptions,
  RingAnswerWatchPace,
} from "@/client/logic/universal-signer/ringAnswerWatch";

/**
 * How often the app's relay channel is looked at while Pubky Ring has the request, and the longest
 * wait while the relay gives no usable reply. Ring's answer stays on the relay for about five
 * minutes, so a few seconds keeps Passport close behind the app without crowding the relay.
 */
export const EXTERNAL_APPROVAL_WATCH_PACE: RingAnswerWatchPace = {
  intervalMs: 3_000,
  maxIntervalMs: 30_000,
};

/** One look gives up after this, so a relay that never answers cannot stall the watch. */
const LOOK_TIMEOUT_MS = 10_000;

export type RelayFetch = (url: string, init: RequestInit) => Promise<Response>;

export type ExternalApprovalWatchOptions = RingAnswerWatchOptions & { fetch?: RelayFetch };

/**
 * What Passport saw on the app's relay channel when it ended a handoff by itself: the app took
 * and acknowledged Ring's answer (`taken`), or Ring's answer is posted and waits, untouched, for
 * the app (`posted`).
 */
export type ExternalApprovalObservation = "taken" | "posted";

/** What one look at the app's channel found: an {@link ExternalApprovalObservation}, or not. */
export type AppChannelLook = ExternalApprovalObservation | "empty" | "unreachable";

/**
 * Asks the relay whether an answer on the app's channel (`ackUrl`, see `relayAnswerAckUrl`) was
 * posted and whether the app acknowledged it: `true` is `taken`, `false` is `posted`, and `404`
 * (nothing posted yet, or expired) is `empty`; any other reply, or none, is `unreachable`. The
 * request only reads, carries no cookies or referrer, and its URL holds the channel ID, so nothing
 * here logs it.
 */
export async function lookAtAppChannel(
  ackUrl: string,
  fetchFn: RelayFetch,
  signal: AbortSignal,
): Promise<AppChannelLook> {
  const response = await fetchFn(ackUrl, {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.any([signal, AbortSignal.timeout(LOOK_TIMEOUT_MS)]),
  });
  if (response.status === 404) return "empty";
  if (!response.ok) return "unreachable";
  switch ((await response.text()).trim()) {
    case "true":
      return "taken";
    case "false":
      return "posted";
    default:
      return "unreachable";
  }
}

/**
 * Whether a look lets Passport end the handoff. With `requireAppAck` (the app's page is open to
 * receive Passport's outcome message) only `taken` counts, so Passport never gets ahead of the
 * app. Without it Passport can only answer by navigating back to the app, which is where the app
 * takes the answer; a `posted` answer waiting untouched for it then counts too.
 */
export function approvalSeen(look: AppChannelLook, requireAppAck: boolean): RingAnswerLook {
  if (look === "taken" || (look === "posted" && !requireAppAck)) return "answered";
  return look === "unreachable" ? "unreachable" : "waiting";
}
