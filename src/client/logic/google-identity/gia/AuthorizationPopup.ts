import "client-only";

const POPUP_FEATURES = "popup,width=520,height=680";

/** Encapsulates access to the cross-origin popup used for browser authorization. */
export class AuthorizationPopup {
  private constructor(private readonly popupWindow: Window) {}

  /**
   * Opens a blank popup for an authorization whose URL does not exist yet; {@link navigate} sends
   * it there. Call this synchronously inside the click that starts the authorization: browsers
   * only let the task of a user gesture open windows, and WebKit does not carry that gesture across
   * awaited network work such as the lazily imported authorization modules, so a popup opened after
   * that work is blocked on a cold first click in Safari. Returns null when the browser blocked it.
   */
  static openPending(): AuthorizationPopup | null {
    const name = `pubky-passport-google-${globalThis.crypto.randomUUID()}`;
    const popupWindow = globalThis.open("about:blank", name, POPUP_FEATURES);
    return popupWindow ? new AuthorizationPopup(popupWindow) : null;
  }

  /**
   * Sends the popup to the authorization URL. Navigation keeps the same window object, so
   * {@link isMessageSource} and {@link isClosed} stay valid across it.
   */
  navigate(url: URL): void {
    this.popupWindow.location.replace(url.href);
  }

  isMessageSource(source: MessageEventSource | null): boolean {
    return source === this.popupWindow;
  }

  isClosed(): boolean {
    return this.popupWindow.closed;
  }

  close(): void {
    try {
      if (!this.isClosed()) this.popupWindow.close();
    } catch {
      /* Cross-origin popup cleanup is best effort. */
    }
  }
}
