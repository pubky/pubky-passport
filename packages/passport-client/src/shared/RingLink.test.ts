import { expect, test } from "vitest";
import { createRingLink } from "./RingLink.js";
test("hides the value from every implicit serialization and stops revealing on invalidation", () => {
  let value: string | undefined = "pubkyauth://" + "private-canary";
  const link = createRingLink(() => value);
  expect(link.reveal()).toBe(value);
  expect(String(link)).toBe("[RingLink]");
  expect(JSON.stringify({ link })).toBe('{"link":"[RingLink]"}');
  expect(Object.values(link).filter((v) => typeof v === "string")).toEqual([]);
  value = undefined;
  expect(link.reveal()).toBeUndefined();
});
