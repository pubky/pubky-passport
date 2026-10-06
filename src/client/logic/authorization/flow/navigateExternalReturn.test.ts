// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { LOGGER } from "@/libs/logger/logger";
import { navigateExternalReturn } from "./navigateExternalReturn";

afterEach(() => vi.restoreAllMocks());

it.each([
  undefined,
  "",
  "not a URL",
  "http://app.example/",
  "javascript:alert(1)",
  "https://name@app.example/",
  "https://name:password@app.example/",
])("never navigates to an unusable callback: %#", (callback) => {
  const replace = vi.fn();
  const result = navigateExternalReturn({ location: { replace } } as unknown as Window, callback);
  expect(result).toBe("unavailable");
  expect(replace).not.toHaveBeenCalled();
});

it("navigates only the exact validated callback without sending a message or closing", () => {
  const callback = "https://app.example:8443/return?opaque=a%2Bb#section";
  const replace = vi.fn();
  const appWindow = new Proxy(
    { location: { replace } },
    {
      get(target, key) {
        if (key !== "location") throw new Error("Only navigation is allowed");
        return target.location;
      },
    },
  );
  expect(navigateExternalReturn(appWindow as unknown as Window, callback)).toBe("navigated");
  expect(replace).toHaveBeenCalledExactlyOnceWith(callback);
});

it("contains navigation failure without logging callback content", () => {
  const cause = new Error("callback-private-payload");
  const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
  const appWindow = {
    location: {
      replace() {
        throw cause;
      },
    },
  };
  const result = navigateExternalReturn(
    appWindow as unknown as Window,
    "https://app.example/private",
  );
  expect(result).toBe("unavailable");
  expect(JSON.stringify(warn.mock.calls)).not.toContain("private");
});
