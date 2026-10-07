import type { PassportEntry } from "../client/PassportClient.js";
import type { PassportInstance } from "../instance/PassportInstance.js";
import { authorizeUrl } from "../shared/authorizeUrl.js";
import { systemClock, type Clock } from "../shared/Clock.js";
import type { PopupPort, PopupRequest } from "./PopupPort.js";
import { popupFeatures } from "./popupFeatures.js";

type OpenWindow = (url: string, name: string, features: string) => Window | null | undefined;

/** Browser access is lazy; only the synchronous facade calls open(). */
export class BrowserPopup implements PopupPort {
  private readonly watches = new Set<() => void>();
  private readonly retries = new WeakMap<PopupRequest, { url: string; features: string }>();
  private disposed = false;
  constructor(
    private readonly appWindow: () => Window = () => window,
    private readonly openWindow?: OpenWindow,
    private readonly clock: Clock = systemClock,
    /** The screen the current sign-in asks Passport to open on. */
    private readonly entry: () => PassportEntry | undefined = () => undefined,
  ) {}

  open(request: PopupRequest, target: "named" | "blank" = "named"): Window | null | undefined {
    if (this.disposed) return null;
    try {
      const retry = target === "blank" ? this.retries.get(request) : undefined;
      this.retries.delete(request);
      const opener = this.appWindow();
      const url =
        retry?.url ??
        (request.profileKey !== undefined
          ? `${request.instance.origin}/#profile=${encodeURIComponent(request.profileKey)}`
          : request.authorizationUrl === undefined
            ? "about:blank"
            : authorizeUrl(
                request.instance.origin,
                request.authorizationUrl,
                false,
                "mainnet",
                this.entry(),
              ));
      const features = retry?.features ?? popupFeatures(opener);
      const name =
        target === "blank"
          ? "_blank"
          : `pubky-passport-${request.attemptId}${request.profileKey !== undefined ? "-profile" : request.generation > 0 ? `-r${request.generation}` : ""}`;
      const popup = this.openWindow
        ? this.openWindow(url, name, features)
        : opener.open(url, name, features);
      if (popup === undefined) {
        // The synchronous blank retry must reuse the first call's native arguments.
        if (target === "named") this.retries.set(request, { url, features });
        return undefined;
      }
      if (!popup || this.isClosed(popup)) return null;
      this.focus(popup);
      if (url === "about:blank") {
        try {
          popup.document.title = "Opening Passport…";
          popup.document.body.textContent = "Opening Passport…";
        } catch {
          /* A blocked document write or an already navigating window still belongs to us. */
        }
      }
      return popup;
    } catch {
      return null;
    }
  }

  navigate(popup: Window, instance: PassportInstance, authorizationUrl: string): boolean {
    return attempt(() =>
      popup.location.replace(
        authorizeUrl(instance.origin, authorizationUrl, false, "mainnet", this.entry()),
      ),
    );
  }
  focus(popup: Window): void {
    attempt(() => popup.focus());
  }
  close(popup: Window): void {
    attempt(() => popup.close());
  }
  isClosed(popup: Window): boolean {
    try {
      return popup.closed;
    } catch {
      return true;
    }
  }
  post(popup: Window, message: unknown, origin: string): boolean {
    return origin !== "*" && attempt(() => popup.postMessage(message, origin));
  }

  watch(popup: Window, closed: () => void, failed?: (cause: unknown) => void): () => void {
    if (this.disposed) return () => {};
    const cleanups: (() => void)[] = [];
    let active = true;
    let cancelTimer = () => {};
    const stop = () => {
      if (!active) return;
      active = false;
      this.watches.delete(stop);
      attempt(cancelTimer);
      for (const cleanup of cleanups) attempt(cleanup);
    };
    const check = () => {
      if (!active || !this.isClosed(popup)) return;
      stop();
      notify(closed);
    };
    const poll = () => {
      if (!active) return;
      check();
      if (active)
        cancelTimer = this.clock.schedule(() => {
          try {
            poll();
          } catch (e) {
            stop();
            notify(failed, e);
          }
        }, 500);
    };
    const listen = (target: EventTarget, type: string) => {
      cleanups.push(() => target.removeEventListener(type, check));
      target.addEventListener(type, check);
    };
    this.watches.add(stop);
    try {
      const opener = this.appWindow();
      listen(opener, "focus");
      listen(opener.document, "visibilitychange");
      listen(opener, "pageshow");
      poll();
      return stop;
    } catch (e) {
      stop();
      throw e;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const stop of this.watches) stop();
  }
}

function attempt(operation: () => void): boolean {
  try {
    operation();
    return true;
  } catch {
    return false;
  }
}
function notify<T extends unknown[]>(
  callback: ((...args: T) => void) | undefined,
  ...args: T
): void {
  try {
    void Promise.resolve(callback?.(...args)).catch(() => {});
  } catch {
    /* Internal callbacks cannot interrupt cleanup. */
  }
}
