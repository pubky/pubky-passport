import "client-only";

import { LOGGER } from "../../../../libs/logger/logger";

export type AuthorizationOutcome = "success" | "error" | "cancel";

const MESSAGE_TYPE = "pubky-passport.authorization-outcome";
const ACKNOWLEDGEMENT_TYPE = "pubky-passport.authorization-outcome-ack";
const MESSAGE_VERSION = 1;
const ACKNOWLEDGEMENT_TIMEOUT_MS = 3_000;

/** Uses an acknowledged opener message when possible, then falls back to navigation. */
export async function handoffAuthorizationOutcome(
  appWindow: Window,
  callback: string,
  outcome: AuthorizationOutcome,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return true;

  const targetOrigin = callbackOrigin(callback);
  if (!targetOrigin) return false;

  const opener = liveOpener(appWindow);
  if (!opener) return navigate(appWindow, callback);

  const messageId = createMessageId(appWindow);
  if (!messageId) return navigate(appWindow, callback);

  const acknowledged = await postOutcomeAndWaitForAcknowledgement(
    appWindow,
    opener,
    targetOrigin,
    messageId,
    outcome,
    signal,
  );
  if (signal.aborted) return true;
  if (!acknowledged) return navigate(appWindow, callback);

  return closeWindow(appWindow) || navigate(appWindow, callback);
}

async function postOutcomeAndWaitForAcknowledgement(
  appWindow: Window,
  opener: Window,
  targetOrigin: string,
  messageId: string,
  outcome: AuthorizationOutcome,
  signal: AbortSignal,
): Promise<boolean> {
  const acknowledgement = new OutcomeAcknowledgement(
    appWindow,
    opener,
    targetOrigin,
    messageId,
    signal,
  );

  try {
    const result = acknowledgement.wait();
    if (!signal.aborted) {
      opener.postMessage(Object.freeze({
        type: MESSAGE_TYPE,
        version: MESSAGE_VERSION,
        outcome,
        messageId,
      }), targetOrigin);
    }
    return await result;
  } catch {
    logHandoffFailure("post_message");
    acknowledgement.cancel();
    return false;
  }
}

class OutcomeAcknowledgement {
  private resolveResult: (acknowledged: boolean) => void = () => undefined;
  private readonly result: Promise<boolean>;
  private settled = false;
  private timeoutId: number | undefined;

  constructor(
    private appWindow: Window,
    private opener: Window,
    private targetOrigin: string,
    private messageId: string,
    private signal: AbortSignal,
  ) {
    this.result = new Promise((resolve) => {
      this.resolveResult = resolve;
    });
  }

  wait(): Promise<boolean> {
    if (this.signal.aborted) {
      this.finish(false);
      return this.result;
    }

    this.appWindow.addEventListener("message", this.handleMessage);
    this.signal.addEventListener("abort", this.handleAbort, { once: true });
    this.timeoutId = this.appWindow.setTimeout(
      this.handleTimeout,
      ACKNOWLEDGEMENT_TIMEOUT_MS,
    );
    return this.result;
  }

  cancel(): void {
    this.finish(false);
  }

  private handleMessage = (event: MessageEvent): void => {
    if (
      event.source === this.opener
      && event.origin === this.targetOrigin
      && isAcknowledgement(event.data, this.messageId)
    ) {
      this.finish(true);
    }
  };

  private handleTimeout = (): void => {
    this.finish(false);
  };

  private handleAbort = (): void => {
    this.finish(false);
  };

  private finish(acknowledged: boolean): void {
    if (this.settled) return;

    this.settled = true;
    try {
      this.appWindow.removeEventListener("message", this.handleMessage);
    } catch {
      logHandoffFailure("remove_message_listener");
    }
    try {
      this.signal.removeEventListener("abort", this.handleAbort);
    } catch {
      logHandoffFailure("remove_abort_listener");
    }
    try {
      if (this.timeoutId !== undefined) this.appWindow.clearTimeout(this.timeoutId);
    } catch {
      logHandoffFailure("clear_acknowledgement_timeout");
    }
    this.resolveResult(acknowledged);
  }
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
  return Object.keys(acknowledgement).length === 3
    && acknowledgement.type === ACKNOWLEDGEMENT_TYPE
    && acknowledgement.version === MESSAGE_VERSION
    && acknowledgement.messageId === messageId;
}

function navigate(appWindow: Window, callback: string): boolean {
  try {
    appWindow.location.replace(callback);
    return true;
  } catch {
    logHandoffFailure("navigate");
    return false;
  }
}

function logHandoffFailure(operation: string): void {
  LOGGER.warn("authorize.callback_handoff.failed", {
    operation,
  });
}
