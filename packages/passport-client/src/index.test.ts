import { expect, test } from "vitest";

import * as core from "./index.js";
import * as element from "./element.js";

test("the core entry exports only createPassportClient at runtime", () => {
  expect(Object.keys(core)).toEqual(["createPassportClient"]);
});

test("the element entry only defines <pubky-passport>", () => {
  expect(Object.keys(element)).toEqual([]);
  expect(customElements.get("pubky-passport")).toBeDefined();
});

test("a public client has exactly the five public methods", () => {
  const client = core.createPassportClient({ instance: "https://passport.example" });
  try {
    expect(Object.keys(client).sort()).toEqual([
      "describe",
      "dispose",
      "reset",
      "signIn",
      "subscribe",
    ]);
    expect(Object.isFrozen(client)).toBe(true);
  } finally {
    client.dispose();
  }
});

test("options outside the public set are refused", () => {
  expect(() =>
    core.createPassportClient({ requireProfile: false } as unknown as core.PassportClientOptions),
  ).toThrow(/requireProfile: Unknown option/);
  expect(() =>
    core.createPassportClient({
      development: { allowLoopbackInstance: true },
    } as unknown as core.PassportClientOptions),
  ).toThrow(/development: Unknown option/);
});
