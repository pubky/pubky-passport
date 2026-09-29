/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { announceExternalNavigation, guardPendingRequest } from "./leaveGuard";

function unload(): BeforeUnloadEvent {
  const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return event;
}

describe("guardPendingRequest", () => {
  let remove: (() => void) | undefined;

  afterEach(() => {
    remove?.();
    remove = undefined;
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("asks before leaving only while a request is pending", () => {
    let pending = true;
    remove = guardPendingRequest(window, () => pending);

    expect(unload().defaultPrevented).toBe(true);
    pending = false;
    expect(unload().defaultPrevented).toBe(false);
  });

  it("never asks in a popup whose opener is still open, which closes it itself", () => {
    const opener = { closed: false };
    Object.defineProperty(window, "opener", { configurable: true, value: opener });
    try {
      remove = guardPendingRequest(window, () => true);

      expect(unload().defaultPrevented).toBe(false);
      // Once the app's window has closed, nobody else will close the popup.
      opener.closed = true;
      expect(unload().defaultPrevented).toBe(true);
    } finally {
      Object.defineProperty(window, "opener", { configurable: true, value: null });
    }
  });

  it("lets a hand-off to another app through without asking", () => {
    const now = vi.spyOn(window.performance, "now").mockReturnValue(10_000);
    remove = guardPendingRequest(window, () => true);
    const link = document.createElement("a");
    link.href = "lightning:lnbc1";
    link.addEventListener("click", (event) => event.preventDefault());
    document.body.append(link);

    link.click();
    expect(unload().defaultPrevented).toBe(false);
    now.mockReturnValue(11_500);
    expect(unload().defaultPrevented).toBe(true);

    announceExternalNavigation(window);
    expect(unload().defaultPrevented).toBe(false);
  });

  it("still asks for same-window web links and stops once removed", () => {
    vi.spyOn(window.performance, "now").mockReturnValue(100_000);
    remove = guardPendingRequest(window, () => true);
    const link = document.createElement("a");
    link.href = "/";
    link.addEventListener("click", (event) => event.preventDefault());
    document.body.append(link);

    link.click();
    expect(unload().defaultPrevented).toBe(true);
    remove();
    remove = undefined;
    expect(unload().defaultPrevented).toBe(false);
  });
});
