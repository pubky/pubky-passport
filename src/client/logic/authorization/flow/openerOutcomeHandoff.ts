import "client-only";

import { Result } from "better-result";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { OpenerChannel } from "../opener/OpenerChannel";
import type { ApprovalFailureReason } from "./approvalFailureReason";
import {
  handoffAuthorizationOutcome,
  type AuthorizationOutcome,
  type AuthorizationHandoffStatus,
} from "./authorizationOutcomeHandoff";

/** Uses the verified v2 opener, or delegates the unchanged callback-based v1 handoff. */
export async function handoffOpenerOutcome(
  appWindow: Window,
  callback: string | undefined,
  outcome: AuthorizationOutcome,
  signal: AbortSignal,
  channel?: OpenerChannel,
  code?: ApprovalFailureReason,
): Promise<AuthorizationHandoffStatus> {
  if (signal.aborted) return "aborted";
  if (!channel?.verifiedOpener())
    return callback
      ? handoffAuthorizationOutcome(appWindow, callback, outcome, signal)
      : "unavailable";

  let ack: ReturnType<OpenerChannel["waitForAck"]> | undefined;
  try {
    const messageId = appWindow.crypto.randomUUID();
    ack = channel.waitForAck(messageId, signal);
    const posted = channel.post({
      type: "pubky-passport.authorization-outcome",
      messageId,
      outcome,
      ...(outcome === "error" && code ? { code } : {}),
    });
    if (Result.isError(posted)) return fallback(appWindow, callback, signal);
    const acknowledged = await ack.result;
    if (signal.aborted || !channel.verifiedOpener()) return "aborted";
    if (acknowledged) {
      appWindow.close();
      if (appWindow.closed) return "acknowledged-and-closed";
    } else LOGGER.warn("authorize.opener_handoff.failed", { operation: "acknowledge" });
  } catch (e) {
    LOGGER.warn("authorize.opener_handoff.failed", {
      operation: "handoff",
      ...safeErrorLogFields(e),
    });
  } finally {
    ack?.cancel();
  }
  return fallback(appWindow, callback, signal);
}

function fallback(
  appWindow: Window,
  callback: string | undefined,
  signal: AbortSignal,
): AuthorizationHandoffStatus {
  if (signal.aborted) return "aborted";
  if (!callback) return "unavailable";
  try {
    const url = new URL(callback);
    if (url.protocol !== "https:" || url.username || url.password) return "unavailable";
    appWindow.location.replace(callback);
    return "navigated";
  } catch (e) {
    LOGGER.warn("authorize.opener_handoff.failed", {
      operation: "navigate",
      ...safeErrorLogFields(e),
    });
    return "unavailable";
  }
}
