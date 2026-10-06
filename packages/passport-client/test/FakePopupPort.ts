import { expect } from "vitest";
import type { PassportInstance } from "../src/instance/PassportInstance.js";
import type { PopupPort, PopupRequest } from "../src/popup/PopupPort.js";

/** A WindowProxy-shaped fixture that reports forbidden reads outside caught exceptions. */
export class FakePopupWindow {
  readonly violations: string[] = [];
  readonly navigations: string[] = [];
  readonly posts: { message: unknown; origin: string }[] = [];
  readonly document = { title: "", body: { textContent: "" } };
  closed = false;
  focusCalls = 0;
  closeCalls = 0;
  documentAllowed = false;
  failure: "closed" | "focus" | "close" | "postMessage" | "replace" | "document" | undefined;
  readonly window: Window;
  constructor() {
    Object.defineProperty(this.document.body, "innerHTML", {
      set: () => this.violate("innerHTML"),
    });
    const invoke = (name: FakePopupWindow["failure"]) => {
      if (this.failure === name) throw new Error("Native operation unavailable");
    };
    const allowed: Record<string, () => unknown> = {
      closed: () => {
        invoke("closed");
        return this.closed;
      },
      focus: () => () => {
        invoke("focus");
        this.focusCalls++;
      },
      close: () => () => {
        invoke("close");
        this.closeCalls++;
        this.closed = true;
      },
      postMessage: () => (message: unknown, origin: string) => {
        invoke("postMessage");
        this.posts.push({ message, origin });
      },
      location: () =>
        new Proxy(
          {
            replace: (url: string) => {
              invoke("replace");
              this.navigations.push(url);
            },
          },
          {
            get: (location, property) =>
              property === "replace"
                ? location.replace
                : this.violate(`location.${String(property)}`),
          },
        ),
      document: () => {
        invoke("document");
        if (!this.documentAllowed) this.violate("cross-origin document");
        return this.document;
      },
    };
    this.window = new Proxy({} as Window, {
      get: (_target, property) => {
        const getter = typeof property === "string" ? allowed[property] : undefined;
        return getter ? getter() : this.violate(String(property));
      },
    });
  }
  private violate(property: string): never {
    this.violations.push(property);
    throw new Error("Forbidden WindowProxy property");
  }
  assertHealthy(): void {
    expect(this.violations).toEqual([]);
  }
}

/** Scripted port for facade tests; assertions use the independently guarded Window fixture. */
export class FakePopupPort implements PopupPort {
  readonly opens: { request: PopupRequest; target: "named" | "blank" }[] = [];
  readonly navigations: { popup: Window; instance: PassportInstance; authorizationUrl: string }[] =
    [];
  readonly results: (Window | null | undefined)[] = [];
  readonly watches = new Map<Window, () => void>();
  open(request: PopupRequest, target: "named" | "blank" = "named"): Window | null | undefined {
    this.opens.push({ request, target });
    return this.results.shift();
  }
  navigate(popup: Window, instance: PassportInstance, authorizationUrl: string): boolean {
    this.navigations.push({ popup, instance, authorizationUrl });
    return true;
  }
  focus(popup: Window): void {
    popup.focus();
  }
  close(popup: Window): void {
    popup.close();
  }
  isClosed(popup: Window): boolean {
    return popup.closed;
  }
  post(popup: Window, message: unknown, origin: string): boolean {
    popup.postMessage(message, origin);
    return true;
  }
  watch(popup: Window, closed: () => void): () => void {
    this.watches.set(popup, closed);
    return () => {
      this.watches.delete(popup);
    };
  }
  dispose(): void {
    this.watches.clear();
  }
}
