import { expect, test } from "vitest";
import { DEFAULT_PASSPORT_HOST, DEFAULT_PASSPORT_INSTANCE } from "./defaults.js";

test("keeps the default host label consistent with its origin", () => {
  expect(new URL(DEFAULT_PASSPORT_INSTANCE).host).toBe(DEFAULT_PASSPORT_HOST);
});
