import { expect, test, vi } from "vitest";
import { scrubReturnUrl } from "./scrubReturnUrl.js";

const href =
  "https://app.example:8443/%7Euser/?keep=1&pubky-passport=s." +
  "A".repeat(22) +
  "&errorCode=cancel&keep=2&errorMessage=description&errorCode=x#fragment";

test("removes only return parameters while preserving page, other values and history state", () => {
  const state = { appNavigation: [1, 2, 3] };
  const history = { state, replaceState: vi.fn() };
  const url = new URL(href);
  scrubReturnUrl(url, history);
  expect(url.href).toBe(href);
  expect(history.replaceState).toHaveBeenCalledExactlyOnceWith(
    state,
    "",
    "https://app.example:8443/%7Euser/?keep=1&keep=2#fragment",
  );
});

test.each(["state", "replaceState", "silent"] as const)(
  "contains native history behavior: %s",
  (mode) => {
    const replaceState = vi.fn(() => {
      if (mode === "replaceState") throw new Error("native failure");
    });
    const history = {
      get state() {
        if (mode === "state") throw new Error("native failure");
        return null;
      },
      replaceState,
    };
    expect(() => scrubReturnUrl(new URL(href), history)).not.toThrow();
    expect(replaceState).toHaveBeenCalledTimes(mode === "state" ? 0 : 1);
  },
);
