import { afterEach, expect, test, vi } from "vitest";
import { FakePopupPort, FakePopupWindow } from "../../test/FakePopupPort.js";
import { BrowserPopup } from "./BrowserPopup.js";
import { openPassportPopup } from "./openPassportPopup.js";

const REQUEST = {
  instance: {
    origin: "https://passport.example",
    host: "passport.example",
    isCustom: false,
  },
  attemptId: "attempt-001",
  generation: 2,
};
const windows: FakePopupWindow[] = [];
afterEach(() => {
  for (const fake of windows.splice(0)) fake.assertHealthy();
});
function setup() {
  const fake = new FakePopupWindow();
  windows.push(fake);
  const port = new FakePopupPort();
  return { port, fake };
}

test.each([undefined, true, false])(
  "activation %s produces at most one safe diagnostic after the synchronous retry",
  (activation) => {
    const { port, fake } = setup();
    port.results.push(undefined, fake.window);
    const result = openPassportPopup(port, REQUEST, activation);
    expect(result.kind).toBe("live");
    if (result.kind === "live") expect(result.popup).toBe(fake.window);
    expect(port.opens).toEqual([
      { request: REQUEST, target: "named" },
      { request: REQUEST, target: "blank" },
    ]);
    expect(port.opens.every(({ request }) => request === REQUEST)).toBe(true);
    expect(result.diagnostic).toEqual(
      activation === false
        ? { code: "no_user_activation", attemptId: REQUEST.attemptId }
        : undefined,
    );
  },
);

test.each([false, true])("a throwing open is contained on the retry=%s path", (retry) => {
  const { port } = setup();
  const canary = ["private", "native", "exception"].join("-");
  const open = vi.spyOn(port, "open").mockImplementation(() => {
    throw new Error(canary);
  });
  if (retry) open.mockReturnValueOnce(undefined);
  const result = openPassportPopup(port, REQUEST, false);
  expect(result.kind).toBe(retry ? "unreachable" : "blocked");
  expect(open).toHaveBeenCalledTimes(retry ? 2 : 1);
  expect(JSON.stringify(result)).not.toContain(canary);
});

test.each([false, true])("an unreadable closed flag is contained on the retry=%s path", (retry) => {
  const { port, fake } = setup();
  fake.failure = "closed";
  if (retry) port.results.push(undefined);
  port.results.push(fake.window);
  const result = openPassportPopup(port, REQUEST);
  expect(result).toEqual({ kind: retry ? "unreachable" : "blocked" });
  expect(port.opens).toHaveLength(retry ? 2 : 1);
});

test.each(["null", "closed", "undefined"] as const)(
  "a non-live %s retry produces no window for Reopen/focus/default callers to dispatch",
  (retry) => {
    const { port, fake } = setup();
    fake.closed = true;
    port.results.push(
      undefined,
      retry === "null" ? null : retry === "closed" ? fake.window : undefined,
    );
    const result = openPassportPopup(port, REQUEST);
    expect(result).toEqual({ kind: "unreachable" });
    expect(port.opens).toHaveLength(2);
  },
);

test.each([false, true])(
  "the retry reuses native arguments despite changed geometry (prepared=%s)",
  (prepared) => {
    const { fake } = setup();
    fake.documentAllowed = true;
    const opener = {
      outerWidth: 1000,
      outerHeight: 900,
      screenX: 0,
      screenY: 0,
      screen: { availHeight: 1000 },
    } as Window;
    const native = vi.fn<(...args: string[]) => Window | null | undefined>(() => fake.window);
    native.mockImplementationOnce(() => {
      Object.defineProperty(opener, "outerWidth", { value: 1500, configurable: true });
      return undefined;
    });
    const popup = new BrowserPopup(() => opener, native);
    const request = {
      ...REQUEST,
      ...(prepared ? { authorizationUrl: "pubkyauth://" + ["private", "request"].join("-") } : {}),
    };
    try {
      expect(openPassportPopup(popup, request).kind).toBe("live");
      expect(native.mock.calls[1]).toEqual([
        native.mock.calls[0]![0],
        "_blank",
        native.mock.calls[0]![2],
      ]);
      expect(openPassportPopup(popup, request).kind).toBe("live");
      expect(native.mock.calls[2]![2]).not.toBe(native.mock.calls[0]![2]);
    } finally {
      popup.dispose();
    }
  },
);

test("a blank open for a different request never reuses another request's snapshot", () => {
  const { fake } = setup();
  fake.documentAllowed = true;
  const native = vi.fn<(...args: string[]) => Window | null | undefined>(() => fake.window);
  native.mockReturnValueOnce(undefined);
  const popup = new BrowserPopup(() => window, native);
  const authorizationUrl = "pubkyauth://" + ["private", "second", "request"].join("-");
  try {
    expect(popup.open(REQUEST)).toBeUndefined();
    expect(popup.open({ ...REQUEST, authorizationUrl }, "blank")).toBe(fake.window);
    expect(native.mock.calls[1]![0]).toBe(
      REQUEST.instance.origin + "/authorize#d=" + encodeURIComponent(authorizationUrl),
    );
    expect(native.mock.calls[1]![1]).toBe("_blank");
  } finally {
    popup.dispose();
  }
});
