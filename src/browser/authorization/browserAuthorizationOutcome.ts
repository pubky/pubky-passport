import "client-only";

export type BrowserAuthorizationOutcome = "success" | "error" | "cancel";

const MESSAGE_TYPE = "pubky-passport.authorization-outcome";
const ACKNOWLEDGEMENT_TYPE = "pubky-passport.authorization-outcome-ack";
const MESSAGE_VERSION = 1;
const ACKNOWLEDGEMENT_TIMEOUT_MS = 3_000;

export function completeBrowserAuthorizationOutcome(
  browserWindow: Window,
  callback: string,
  outcome: BrowserAuthorizationOutcome,
): Promise<boolean> {
  let targetOrigin: string;
  try {
    targetOrigin = new URL(callback).origin;
  } catch {
    return Promise.resolve(false);
  }

  let opener: Window | null;
  try {
    opener = browserWindow.opener;
  } catch {
    return Promise.resolve(navigate(browserWindow, callback));
  }

  if (!opener || isClosed(opener)) {
    return Promise.resolve(navigate(browserWindow, callback));
  }

  return new Promise((resolve) => {
    const messageId = browserWindow.crypto.randomUUID();
    let timeoutId: number | undefined;
    let settled = false;
    const cleanup = () => {
      browserWindow.removeEventListener("message", acknowledge);
      if (timeoutId !== undefined) browserWindow.clearTimeout(timeoutId);
    };
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(completed);
    };
    const fallback = () => finish(navigate(browserWindow, callback));
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
        browserWindow.close();
        if (browserWindow.closed) {
          finish(true);
          return;
        }
      } catch {
        // Callback navigation remains the cross-browser fallback.
      }
      fallback();
    }

    try {
      browserWindow.addEventListener("message", acknowledge);
      timeoutId = browserWindow.setTimeout(fallback, ACKNOWLEDGEMENT_TIMEOUT_MS);
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

function isAcknowledgement(value: unknown, messageId: string): boolean {
  if (typeof value !== "object" || value === null) return false;
  const acknowledgement = value as Record<string, unknown>;
  return Object.keys(acknowledgement).length === 3
    && acknowledgement.type === ACKNOWLEDGEMENT_TYPE
    && acknowledgement.version === MESSAGE_VERSION
    && acknowledgement.messageId === messageId;
}

function isClosed(browserWindow: Window): boolean {
  try {
    return browserWindow.closed;
  } catch {
    return true;
  }
}

function navigate(browserWindow: Window, callback: string): boolean {
  try {
    browserWindow.location.replace(callback);
    return true;
  } catch {
    return false;
  }
}
