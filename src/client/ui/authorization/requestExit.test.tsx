/** @vitest-environment jsdom */

import { cleanup, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BackToAppAction,
  closeRequestWindow,
  EDIT_LINK_BACK_TIMEOUT_MS,
  goToPassport,
  leaveEditLink,
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

describe("leaveEditLink", () => {
  /** A window an edit link opened: `closes` when a script may close it, `length` its history. */
  function editWindow({ closes = false, length = 1 } = {}) {
    let pagehide: (() => void) | undefined;
    let timer: { callback: () => void; delay: number | undefined } | undefined;
    const target = {
      closed: false,
      close: vi.fn(() => {
        if (closes) target.closed = true;
      }),
      history: { length, back: vi.fn() },
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        pagehide = listener;
      }),
      setTimeout: vi.fn((callback: () => void, delay?: number) => {
        timer = { callback, delay };
        return 1;
      }),
    };
    return {
      target: target as unknown as Window,
      fake: target,
      leavePage: () => pagehide?.(),
      timer: () => timer,
    };
  }

  it("closes a window a script may close, and goes nowhere else", () => {
    const home = vi.fn();
    const { target, fake } = editWindow({ closes: true, length: 3 });

    leaveEditLink(home, target);

    expect(fake.close).toHaveBeenCalledOnce();
    expect(fake.history.back).not.toHaveBeenCalled();
    expect(home).not.toHaveBeenCalled();
  });

  it("goes back to the page before in this tab, and nowhere else once the page is left", () => {
    const home = vi.fn();
    const { target, fake, leavePage, timer } = editWindow({ length: 2 });

    leaveEditLink(home, target);

    expect(fake.history.back).toHaveBeenCalledOnce();
    expect(fake.addEventListener).toHaveBeenCalledWith("pagehide", expect.any(Function), {
      once: true,
    });
    expect(timer()?.delay).toBe(EDIT_LINK_BACK_TIMEOUT_MS);
    leavePage();
    timer()?.callback();
    expect(home).not.toHaveBeenCalled();
  });

  it("goes home when going back stayed on this page", () => {
    const home = vi.fn();
    const { target, timer } = editWindow({ length: 2 });

    leaveEditLink(home, target);
    expect(home).not.toHaveBeenCalled();
    timer()?.callback();

    expect(home).toHaveBeenCalledOnce();
  });

  it("goes home at once without a page to go back to", () => {
    const home = vi.fn();
    const { target, fake } = editWindow();

    leaveEditLink(home, target);

    expect(fake.history.back).not.toHaveBeenCalled();
    expect(home).toHaveBeenCalledOnce();
  });

  it("goes on when closing throws", () => {
    const home = vi.fn();
    const { target, fake } = editWindow({ length: 2 });
    fake.close.mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });

    leaveEditLink(home, target);

    expect(fake.history.back).toHaveBeenCalledOnce();
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
