import "client-only";

/** Encapsulates access to the cross-origin popup used for browser authorization. */
export class AuthorizationPopup {
  private constructor(private readonly popupWindow: Window) {}

  static open(url: URL, name: string): AuthorizationPopup | null {
    const popupWindow = globalThis.open(url, name, "popup,width=520,height=680");
    return popupWindow ? new AuthorizationPopup(popupWindow) : null;
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
