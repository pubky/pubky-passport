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

/**
 * How long the app's pop-up stays after telling the app the person cancelled, when no
 * acknowledgement comes first (the edit link's wait): a window that closes at once can lose the
 * message (WebKit did), or hand it over without its source, which the app must refuse.
 */
export const CANCEL_CLOSE_DELAY_MS = 1_000;

/**
 * How long the page may still run after its window was closed before Passport takes it that the
 * window stayed open: a closed window runs no more script, so this is reached only in one that did.
 */
export const CLOSE_CONFIRM_MS = 1_000;

/**
 * Uses the verified v2 opener, or delegates the unchanged callback-based v1 handoff. A cancel
 * closes the pop-up whether or not the app acknowledges it, and reports `stayed-open` when the
 * window is still there a moment later, so the page shows its outcome instead of going blank.
 */
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
    if (outcome === "cancel") return await closeAfterCancel(appWindow, ack.result, signal, channel);
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

/** Closes the pop-up once the app acknowledges the cancel, or after {@link CANCEL_CLOSE_DELAY_MS}. */
async function closeAfterCancel(
  appWindow: Window,
  acknowledgement: Promise<boolean>,
  signal: AbortSignal,
  channel: OpenerChannel,
): Promise<AuthorizationHandoffStatus> {
  const acknowledged = await acknowledgedWithin(
    acknowledgement,
    appWindow,
    CANCEL_CLOSE_DELAY_MS,
    signal,
  );
  if (signal.aborted || !channel.verifiedOpener()) return "aborted";
  const path = acknowledged ? "acknowledged" : "timer";
  LOGGER.info("authorize.opener_handoff.closing", { outcome: "cancel", path });
  try {
    appWindow.close();
  } catch (e) {
    LOGGER.warn("authorize.opener_handoff.failed", {
      operation: "close",
      path,
      ...safeErrorLogFields(e),
    });
    return "stayed-open";
  }
  // `closed` can turn true in a window that never goes: only a page still running says so.
  if (!(await stillRunningAfter(appWindow, CLOSE_CONFIRM_MS, signal))) return "aborted";
  LOGGER.warn("authorize.opener_handoff.failed", { operation: "close", path });
  return "stayed-open";
}

/** True as soon as `acknowledgement` is; false once `ms` pass without it, or on abort. */
function acknowledgedWithin(
  acknowledgement: Promise<boolean>,
  appWindow: Window,
  ms: number,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    let settled = false;
    const settle = (acknowledged: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      appWindow.clearTimeout(timeoutId);
      resolve(acknowledged);
    };
    const onAbort = () => settle(false);
    const timeoutId = appWindow.setTimeout(() => settle(false), ms);
    signal.addEventListener("abort", onAbort, { once: true });
    void acknowledgement.then((acknowledged) => {
      if (acknowledged) settle(true);
    });
  });
}

/** Whether the page still runs `ms` from now: false at once when `signal` aborts (it left). */
function stillRunningAfter(appWindow: Window, ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      appWindow.clearTimeout(timeoutId);
      resolve(false);
    };
    const timeoutId = appWindow.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
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
