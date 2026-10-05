import { afterEach, expect, test, vi } from "vitest";
import { FakeClock } from "../../test/FakeClock.js";
import { FakePopupWindow } from "../../test/FakePopupPort.js";
import { BrowserPopup } from "./BrowserPopup.js";
import { popupFeatures } from "./popupFeatures.js";

const INSTANCE = {
  origin: "https://passport.example",
  host: "passport.example",
  isCustom: false,
};
const AUTH =
  "pubkyauth://" + ["private", "popup", "material"].join("-") + "?caps=%2Fpub%2Fexample%2F%3Arw";
const REQUEST = { instance: INSTANCE, attemptId: "abcdefghijklmnopqrstuv", generation: 0 };
const resources: { fake: FakePopupWindow; clock: FakeClock; popup: BrowserPopup }[] = [];
afterEach(() => {
  for (const h of resources.splice(0)) {
    h.popup.dispose();
    h.fake.assertHealthy();
    h.clock.assertEmpty();
  }
});
function setup() {
  const fake = new FakePopupWindow();
  const clock = new FakeClock();
  const open = vi.fn<(...args: string[]) => Window | null | undefined>(() => fake.window);
  const opener = window;
  const popup = new BrowserPopup(() => opener, open, clock);
  const h = { fake, clock, open, opener, popup };
  resources.push(h);
  return h;
}

test("the window fake records forbidden nested Location reads even if their exception is caught", () => {
  const fake = new FakePopupWindow();
  try {
    void fake.window.location.href;
  } catch {
    /* Simulate a swallowed native error. */
  }
  expect(fake.violations).toEqual(["location.href"]);
});

test("construction is lazy and opening plus focus happen synchronously", () => {
  const read = vi.fn(() => {
    throw new Error("No browser");
  });
  const popup = new BrowserPopup(read);
  expect(read).not.toHaveBeenCalled();
  expect(popup.open(REQUEST)).toBeNull();
  expect(read).toHaveBeenCalledOnce();
  popup.dispose();
  const h = setup();
  h.fake.documentAllowed = true;
  expect(h.popup.open(REQUEST)).toBe(h.fake.window);
  expect(h.open).toHaveBeenCalledExactlyOnceWith(
    "about:blank",
    "pubky-passport-abcdefghijklmnopqrstuv",
    expect.stringMatching(/^popup,width=520,height=/u),
  );
  expect(h.fake.focusCalls).toBe(1);
  expect(h.fake.document.title).toBe("Opening Passport…");
  expect(h.fake.document.body.textContent).toBe("Opening Passport…");
});
test("prepared opening uses the pinned fragment directly without inspecting the cross-origin document", () => {
  const h = setup();
  h.popup.open({ ...REQUEST, authorizationUrl: AUTH });
  const [url, name, features] = h.open.mock.calls[0]!;
  expect(url).toBe(INSTANCE.origin + "/authorize#d=" + encodeURIComponent(AUTH));
  expect(new URL(url!).search).toBe("");
  expect(name).not.toContain("private");
  expect(features).not.toMatch(/noopener|noreferrer/u);
  expect(h.fake.focusCalls).toBe(1);
});
test("reopen names contain only attempt and generation and blank retry preserves the native undefined result", () => {
  const h = setup();
  h.fake.documentAllowed = true;
  h.popup.open({ ...REQUEST, generation: 3 });
  expect(h.open.mock.calls[0]![1]).toBe("pubky-passport-abcdefghijklmnopqrstuv-r3");
  h.open.mockReturnValueOnce(undefined);
  expect(h.popup.open(REQUEST, "blank")).toBeUndefined();
  expect(h.open.mock.calls[1]![1]).toBe("_blank");
  expect(h.open).toHaveBeenCalledTimes(2);
});
test.each(["null", "throw", "closed", "closed getter"])(
  "opening %s returns blocked without focus",
  (result) => {
    const h = setup();
    if (result === "null") h.open.mockReturnValue(null);
    if (result === "throw")
      h.open.mockImplementation(() => {
        throw new Error(AUTH);
      });
    if (result === "closed") h.fake.closed = true;
    if (result === "closed getter") h.fake.failure = "closed";
    expect(h.popup.open(REQUEST)).toBeNull();
    expect(h.fake.focusCalls).toBe(0);
  },
);
test("blank document access and focus errors do not discard a live Window", () => {
  const h = setup();
  h.fake.failure = "document";
  expect(h.popup.open(REQUEST)).toBe(h.fake.window);
  h.fake.failure = "focus";
  expect(h.popup.open({ ...REQUEST, authorizationUrl: AUTH })).toBe(h.fake.window);
});
test("navigation only replaces the pinned fragment and contains browser failure", () => {
  const h = setup();
  expect(h.popup.navigate(h.fake.window, INSTANCE, AUTH)).toBe(true);
  expect(h.fake.navigations).toEqual([
    INSTANCE.origin + "/authorize#d=" + encodeURIComponent(AUTH),
  ]);
  h.fake.failure = "replace";
  expect(h.popup.navigate(h.fake.window, INSTANCE, AUTH)).toBe(false);
  expect(JSON.stringify(h.popup)).not.toContain("private-popup-material");
});
test("cross-origin operations use only allowed WindowProxy properties and an explicit post origin", () => {
  const h = setup();
  h.popup.focus(h.fake.window);
  expect(h.popup.post(h.fake.window, { type: "hello" }, INSTANCE.origin)).toBe(true);
  expect(h.fake.posts).toEqual([{ message: { type: "hello" }, origin: INSTANCE.origin }]);
  expect(h.popup.post(h.fake.window, {}, "*")).toBe(false);
  expect(h.fake.posts).toHaveLength(1);
  h.popup.close(h.fake.window);
  expect(h.popup.isClosed(h.fake.window)).toBe(true);
  for (const failure of ["focus", "close", "postMessage"] as const) {
    h.fake.failure = failure;
    if (failure === "postMessage")
      expect(h.popup.post(h.fake.window, {}, INSTANCE.origin)).toBe(false);
    else expect(() => h.popup[failure](h.fake.window)).not.toThrow();
  }
});
test("features center on the opener, retain negative monitor positions and cap height", () => {
  const opener = {
    screenX: -1500,
    screenY: 100,
    outerWidth: 1000,
    outerHeight: 900,
    screen: { availHeight: 700 },
  } as Window;
  expect(popupFeatures(opener)).toBe("popup,width=520,height=660,left=-1260,top=220");
  expect(popupFeatures({ screenX: NaN, outerWidth: 0, screen: { availHeight: 0 } } as Window)).toBe(
    "popup,width=520,height=760,left=0,top=0",
  );
});
test.each(["timer", "focus", "visibilitychange", "pageshow"])(
  "a %s close check reports once and removes its watcher",
  (method) => {
    const h = setup();
    const closed = vi.fn();
    const stop = h.popup.watch(h.fake.window, closed);
    expect(closed).not.toHaveBeenCalled();
    h.fake.closed = true;
    if (method === "timer") {
      h.clock.advance(499);
      expect(closed).not.toHaveBeenCalled();
      h.clock.advance(1);
    } else (method === "visibilitychange" ? document : window).dispatchEvent(new Event(method));
    expect(closed).toHaveBeenCalledOnce();
    h.clock.assertEmpty();
    stop();
    stop();
    window.dispatchEvent(new Event("focus"));
    expect(closed).toHaveBeenCalledOnce();
  },
);
test("stopping and disposal invalidate queued timer callbacks and remove event listeners", () => {
  const h = setup();
  const closed = vi.fn();
  const remove = vi.spyOn(window, "removeEventListener");
  const removeDocument = vi.spyOn(document, "removeEventListener");
  const stop = h.popup.watch(h.fake.window, closed);
  const stale = h.clock.captured[0]!;
  stop();
  h.fake.closed = true;
  stale();
  window.dispatchEvent(new Event("focus"));
  expect(closed).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith("focus", expect.any(Function));
  expect(remove).toHaveBeenCalledWith("pageshow", expect.any(Function));
  expect(removeDocument).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  h.fake.closed = false;
  h.popup.watch(h.fake.window, closed);
  h.popup.dispose();
  h.fake.closed = true;
  h.clock.advance(500);
  expect(closed).not.toHaveBeenCalled();
});
test("partial listener installation or scheduling failure removes every installed resource", () => {
  const h = setup();
  const removed = vi.spyOn(window, "removeEventListener");
  const add = vi.spyOn(document, "addEventListener").mockImplementation(() => {
    throw new Error(AUTH);
  });
  expect(() => h.popup.watch(h.fake.window, vi.fn())).toThrow();
  expect(removed).toHaveBeenCalledWith("focus", expect.any(Function));
  add.mockRestore();
  vi.spyOn(h.clock, "schedule").mockImplementation(() => {
    throw new Error(AUTH);
  });
  expect(() => h.popup.watch(h.fake.window, vi.fn())).toThrow();
  h.clock.assertEmpty();
});

test("a later scheduler failure removes the watcher and reports once through the internal hook", () => {
  const h = setup();
  const closed = vi.fn();
  const failed = vi.fn();
  const removed = vi.spyOn(window, "removeEventListener");
  h.popup.watch(h.fake.window, closed, failed);
  vi.spyOn(h.clock, "schedule").mockImplementation(() => {
    throw new Error(AUTH);
  });
  expect(() => h.clock.advance(500)).not.toThrow();
  expect(failed).toHaveBeenCalledOnce();
  expect(removed).toHaveBeenCalledWith("focus", expect.any(Function));
  expect(removed).toHaveBeenCalledWith("pageshow", expect.any(Function));
  h.clock.assertEmpty();
  h.fake.closed = true;
  window.dispatchEvent(new Event("focus"));
  expect(closed).not.toHaveBeenCalled();
});

test.each([false, true])(
  "closed observer failure occurs after cleanup and cannot revive watching (async=%s)",
  async (asyncThrow) => {
    const h = setup();
    const closed = vi.fn(() => {
      h.clock.assertEmpty();
      if (asyncThrow) return Promise.reject(new Error(AUTH));
      throw new Error(AUTH);
    });
    h.popup.watch(h.fake.window, closed);
    h.fake.closed = true;
    expect(() => h.clock.advance(500)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    window.dispatchEvent(new Event("pageshow"));
    h.clock.advance(500);
    expect(closed).toHaveBeenCalledOnce();
  },
);
