/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeepLinkLauncher, ringHandoffMode } from "./deepLinkLauncher";

const DEEP_LINK = "pubkyauth://signin?relay=https://relay.example/inbox&secret=exact-request";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("ringHandoffMode", () => {
  it("opens the deep link on a coarse pointer and scans the QR code otherwise", () => {
    const withPointer = (coarse: boolean) => ({
      matchMedia: (query: string) => ({ matches: coarse && query === "(pointer: coarse)" }),
    });
    expect(ringHandoffMode(withPointer(true) as unknown as Window)).toBe("open");
    expect(ringHandoffMode(withPointer(false) as unknown as Window)).toBe("scan");
    expect(ringHandoffMode(undefined)).toBe("scan");
    expect(
      ringHandoffMode({
        matchMedia: () => {
          throw new Error("unsupported");
        },
      } as unknown as Window),
    ).toBe("scan");
  });
});

describe("DeepLinkLauncher", () => {
  let assign: ReturnType<typeof vi.fn>;
  let appWindow: Window;

  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
    assign = vi.fn();
    appWindow = new Proxy(window, {
      get(target, property) {
        if (property === "location") return { assign };
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("follows the deep link and falls back once the page stays visible", () => {
    const launcher = new DeepLinkLauncher(appWindow, 2_000);
    const listener = vi.fn();
    launcher.subscribe(listener);

    launcher.launch(DEEP_LINK);

    expect(assign).toHaveBeenCalledWith(DEEP_LINK);
    expect(launcher.getState()).toBe("opening");
    vi.advanceTimersByTime(1_999);
    expect(launcher.getState()).toBe("opening");
    vi.advanceTimersByTime(1);
    expect(launcher.getState()).toBe("failed");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("reports the app as opened when the page leaves view before the fallback", () => {
    const launcher = new DeepLinkLauncher(appWindow, 2_000);

    launcher.launch(DEEP_LINK);
    vi.advanceTimersByTime(500);
    setVisibility("hidden");

    expect(launcher.getState()).toBe("opened");
    setVisibility("visible");
    vi.advanceTimersByTime(5_000);
    expect(launcher.getState()).toBe("opened");
  });

  it("runs a navigation function and fails at once when the browser rejects the link", () => {
    const launcher = new DeepLinkLauncher(appWindow, 2_000);
    const navigate = vi.fn(() => {
      throw new Error("blocked");
    });

    launcher.launch(navigate);

    expect(navigate).toHaveBeenCalledOnce();
    expect(launcher.getState()).toBe("failed");
  });

  it("watches a link the person followed without navigating again", () => {
    const launcher = new DeepLinkLauncher(appWindow, 2_000);

    launcher.watch();

    expect(assign).not.toHaveBeenCalled();
    expect(launcher.getState()).toBe("opening");
    vi.advanceTimersByTime(2_000);
    expect(launcher.getState()).toBe("failed");
  });

  it("stops watching when reset or disposed", () => {
    const launcher = new DeepLinkLauncher(appWindow, 2_000);
    const listener = vi.fn();
    launcher.subscribe(listener);

    launcher.launch(DEEP_LINK);
    launcher.reset();
    vi.advanceTimersByTime(5_000);
    expect(launcher.getState()).toBe("idle");

    launcher.launch(DEEP_LINK);
    listener.mockClear();
    launcher.dispose();
    vi.advanceTimersByTime(5_000);
    expect(listener).not.toHaveBeenCalled();
  });
});
