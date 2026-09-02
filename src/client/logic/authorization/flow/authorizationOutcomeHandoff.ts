import "client-only";

import { LOGGER, safeErrorLogFields } from "../../../../libs/logger/logger";

export type AuthorizationOutcome = "success" | "error" | "cancel";
export type AuthorizationHandoffStatus =
  "aborted" | "acknowledged-and-closed" | "navigated" | "unavailable";

const MESSAGE_TYPE = "pubky-passport.authorization-outcome";
const ACKNOWLEDGEMENT_TYPE = "pubky-passport.authorization-outcome-ack";
const MESSAGE_VERSION = 1;
const ACKNOWLEDGEMENT_TIMEOUT_MS = 3_000;

/**
 * Uses an acknowledged opener message when possible, then falls back to navigation.
 *
 * @throws {Error} when acknowledgement listener or timer setup fails; controller
 * callers contain that exceptional browser-runtime path.
 */
export async function handoffAuthorizationOutcome(
  appWindow: Window,
  callback: string,
  outcome: AuthorizationOutcome,
  signal: AbortSignal,
): Promise<AuthorizationHandoffStatus> {
  if (signal.aborted) return "aborted";

  const targetOrigin = callbackOrigin(callback);
  if (!targetOrigin) return "unavailable";
  const opener = liveOpener(appWindow);
  if (!opener) return navigationStatus(appWindow, callback);

  const messageId = createMessageId(appWindow);
  if (!messageId) return navigationStatus(appWindow, callback);
  const acknowledgement = waitForAcknowledgement(
    appWindow,
    opener,
    targetOrigin,
    messageId,
    signal,
  );

  try {
    opener.postMessage(
      Object.freeze({
        type: MESSAGE_TYPE,
        version: MESSAGE_VERSION,
        outcome,
        messageId,
      }),
      targetOrigin,
    );
  } catch (e) {
    logHandoffFailure("post_message", e);
    acknowledgement.cancel();
    return navigationStatus(appWindow, callback);
  }

  const acknowledged = await acknowledgement.result;
  if (signal.aborted) return "aborted";
  if (!acknowledged) return navigationStatus(appWindow, callback);
  if (closeWindow(appWindow)) return "acknowledged-and-closed";
  return navigationStatus(appWindow, callback);
}

function waitForAcknowledgement(
  appWindow: Window,
  opener: Window,
  targetOrigin: string,
  messageId: string,
  signal: AbortSignal,
): { result: Promise<boolean>; cancel: () => void } {
  let finish!: (acknowledged: boolean) => void;
  const result = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  let settled = false;
  let timeoutId: number | undefined;

  const cleanup = () => {
    try {
      appWindow.removeEventListener("message", onMessage);
    } catch (e) {
      logHandoffFailure("remove_message_listener", e);
    }
    try {
      signal.removeEventListener("abort", onAbort);
    } catch (e) {
      logHandoffFailure("remove_abort_listener", e);
    }
    try {
      if (timeoutId !== undefined) appWindow.clearTimeout(timeoutId);
    } catch (e) {
      logHandoffFailure("clear_acknowledgement_timeout", e);
    }
  };
  const settle = (acknowledged: boolean) => {
    if (settled) return;
    settled = true;
    cleanup();
    finish(acknowledged);
  };
  const onMessage = (event: MessageEvent) => {
    if (
      event.source === opener &&
      event.origin === targetOrigin &&
      isAcknowledgement(event.data, messageId)
    )
      settle(true);
  };
  const onAbort = () => settle(false);

  if (signal.aborted) {
    settle(false);
  } else {
    appWindow.addEventListener("message", onMessage);
    signal.addEventListener("abort", onAbort, { once: true });
    timeoutId = appWindow.setTimeout(() => settle(false), ACKNOWLEDGEMENT_TIMEOUT_MS);
  }
  return { result, cancel: () => settle(false) };
}

function callbackOrigin(callback: string): string | undefined {
  try {
    const url = new URL(callback);
    return url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function liveOpener(appWindow: Window): Window | undefined {
  try {
    const opener = appWindow.opener;
    return opener && !opener.closed ? opener : undefined;
  } catch {
    return undefined;
  }
}

function createMessageId(appWindow: Window): string | undefined {
  try {
    return appWindow.crypto.randomUUID();
  } catch {
    return undefined;
  }
}

function closeWindow(appWindow: Window): boolean {
  try {
    appWindow.close();
    return appWindow.closed;
  } catch {
    return false;
  }
}

function isAcknowledgement(value: unknown, messageId: string): boolean {
  if (typeof value !== "object" || value === null) return false;
  const acknowledgement = value as Record<string, unknown>;
  return (
    acknowledgement.type === ACKNOWLEDGEMENT_TYPE &&
    acknowledgement.version === MESSAGE_VERSION &&
    acknowledgement.messageId === messageId
  );
}

function navigationStatus(appWindow: Window, callback: string): AuthorizationHandoffStatus {
  try {
    appWindow.location.replace(callback);
    return "navigated";
  } catch (e) {
    logHandoffFailure("navigate", e);
    return "unavailable";
  }
}

function logHandoffFailure(operation: string, cause: unknown): void {
  LOGGER.warn("authorize.callback_handoff.failed", {
    operation,
    ...safeErrorLogFields(cause),
  });
}
