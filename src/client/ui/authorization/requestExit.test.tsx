/** @vitest-environment jsdom */

import { cleanup, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BackToAppAction,
  closeRequestWindow,
  goToPassport,
  useCameFromPage,
  useOpenedByApp,
} from "./requestExit";

function fakeWindow({ close }: { close: (window: { closed: boolean }) => void }) {
  const target = {
    closed: false,
    close: vi.fn(() => close(target)),
    location: { replace: vi.fn() } as unknown as Location,
  };
  return target;
}

describe("closeRequestWindow", () => {
  it("stays put once the browser closes the popup", () => {
    const target = fakeWindow({ close: (window) => (window.closed = true) });

    closeRequestWindow(target);

    expect(target.close).toHaveBeenCalledOnce();
    expect(target.location.replace).not.toHaveBeenCalled();
  });

  it("goes to Passport's start page when the browser ignores the close", () => {
    // Browsers ignore close() on a window no script opened, and leave `closed` false.
    const target = fakeWindow({ close: () => undefined });

    closeRequestWindow(target);

    expect(target.location.replace).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("goes to Passport's start page when closing throws", () => {
    const target = fakeWindow({
      close: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
    });

    closeRequestWindow(target);

    expect(target.location.replace).toHaveBeenCalledExactlyOnceWith("/");
  });
});

it("replaces the request with Passport's start page", () => {
  const replace = vi.fn();

  goToPassport({ location: { replace } as unknown as Location });

  expect(replace).toHaveBeenCalledExactlyOnceWith("/");
});

describe("useOpenedByApp", () => {
  it("is true in a window another one opened", () => {
    const { result } = renderHook(() => useOpenedByApp({ opener: {} as Window }));
    expect(result.current).toBe(true);
  });

  it("is false in a tab of its own", () => {
    const { result } = renderHook(() => useOpenedByApp({ opener: null }));
    expect(result.current).toBe(false);
  });

  it("is false when reading the opener throws", () => {
    const target = {
      get opener(): Window {
        throw new DOMException("Blocked a frame", "SecurityError");
      },
    };
    const { result } = renderHook(() => useOpenedByApp(target));
    expect(result.current).toBe(false);
  });
});

describe("useCameFromPage", () => {
  it("is true only with a page before this one in the tab", () => {
    const withPage = renderHook(() => useCameFromPage({ history: { length: 2 } as History }));
    expect(withPage.result.current).toBe(true);
    const first = renderHook(() => useCameFromPage({ history: { length: 1 } as History }));
    expect(first.result.current).toBe(false);
  });

  it("is false when the history cannot be read", () => {
    const target = {
      get history(): History {
        throw new DOMException("Blocked", "SecurityError");
      },
    };
    const { result } = renderHook(() => useCameFromPage(target));
    expect(result.current).toBe(false);
  });
});

describe("BackToAppAction", () => {
  afterEach(cleanup);

  it("goes back to the page that sent the person here", async () => {
    const back = vi.fn();
    render(<BackToAppAction target={{ history: { back } as unknown as History }} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Back to the app" }));

    expect(back).toHaveBeenCalledOnce();
  });
});
