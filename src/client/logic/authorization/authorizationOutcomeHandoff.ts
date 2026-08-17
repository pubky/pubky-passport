import "client-only";

export type AuthorizationOutcome = "success" | "error" | "cancel";

const MESSAGE_TYPE = "pubky-passport.authorization-outcome";
const ACKNOWLEDGEMENT_TYPE = "pubky-passport.authorization-outcome-ack";
const MESSAGE_VERSION = 1;
const ACKNOWLEDGEMENT_TIMEOUT_MS = 3_000;

/**
 * Completes an authorization outcome through an acknowledged opener message,
 * falling back to navigation through the exact validated callback.
 */
export class AuthorizationOutcomeHandoff {
  constructor(private appWindow: Window) {}

  complete(
    callback: string,
    outcome: AuthorizationOutcome,
  ): Promise<boolean> {
    const appWindow = this.appWindow;
    let targetOrigin: string;
    try {
      targetOrigin = new URL(callback).origin;
    } catch {
      return Promise.resolve(false);
    }

    let opener: Window | null;
    try {
      opener = appWindow.opener;
    } catch {
      return Promise.resolve(navigate(appWindow, callback));
    }

    if (!opener || isClosed(opener)) {
      return Promise.resolve(navigate(appWindow, callback));
    }

    let messageId: string;
    try {
      messageId = appWindow.crypto.randomUUID();
    } catch {
      return Promise.resolve(navigate(appWindow, callback));
    }

    return new Promise((resolve) => {
      let timeoutId: number | undefined;
      let settled = false;
      const cleanup = () => {
        appWindow.removeEventListener("message", acknowledge);
        if (timeoutId !== undefined) appWindow.clearTimeout(timeoutId);
      };
      const finish = (completed: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(completed);
      };
      const fallback = () => finish(navigate(appWindow, callback));
      function acknowledge(event: MessageEvent): void {
        if (
          settled
          || event.source !== opener
          || event.origin !== targetOrigin
          || !isAcknowledgement(event.data, messageId)
        ) {
          return;
        }

        try {
          appWindow.close();
          if (appWindow.closed) {
            finish(true);
            return;
          }
        } catch {
          // Callback navigation remains the compatible fallback.
        }
        fallback();
      }

      try {
        appWindow.addEventListener("message", acknowledge);
        timeoutId = appWindow.setTimeout(fallback, ACKNOWLEDGEMENT_TIMEOUT_MS);
        opener.postMessage(Object.freeze({
          type: MESSAGE_TYPE,
          version: MESSAGE_VERSION,
          outcome,
          messageId,
        }), targetOrigin);
      } catch {
        fallback();
      }
    });
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

function isClosed(appWindow: Window): boolean {
  try {
    return appWindow.closed;
  } catch {
    return true;
  }
}

function navigate(appWindow: Window, callback: string): boolean {
  try {
    appWindow.location.replace(callback);
    return true;
  } catch {
    return false;
  }
}
