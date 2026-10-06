// @vitest-environment node
import { expect, it } from "vitest";
import { hasLiveOpener } from "./hasLiveOpener";

it.each([null, undefined, { closed: true }])("has no live opener: %#", (opener) => {
  expect(hasLiveOpener({ opener } as Window)).toBe(false);
});
it("reads only the cross-origin-safe closed property", () => {
  const opener = new Proxy(
    { closed: false },
    {
      get(target, key) {
        if (key !== "closed") throw new Error("Forbidden WindowProxy access");
        return target.closed;
      },
    },
  );
  expect(hasLiveOpener({ opener } as unknown as Window)).toBe(true);
});
it.each(["opener", "closed"])("contains a throwing %s getter", (property) => {
  const appWindow =
    property === "opener"
      ? {
          get opener() {
            throw new Error("unavailable");
          },
        }
      : {
          opener: {
            get closed() {
              throw new Error("unavailable");
            },
          },
        };
  expect(hasLiveOpener(appWindow as unknown as Window)).toBe(false);
});
