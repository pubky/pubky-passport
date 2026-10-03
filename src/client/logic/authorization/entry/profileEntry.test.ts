/** @vitest-environment jsdom */
import { afterEach, expect, it } from "vitest";
import { readAndScrubProfileEntry } from "./profileEntry";

const KEY = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

it("reads /#profile=<key> and removes it from the address bar", () => {
  window.history.replaceState(null, "", `/#profile=${KEY}`);
  expect(readAndScrubProfileEntry(window)).toBe(KEY);
  expect(window.location.hash).toBe("");
  expect(window.location.pathname).toBe("/");
});

it.each([
  "",
  "#profile=",
  "#profile=not-a-key",
  `#profile=${KEY}&d=x`,
  `#d=${KEY}`,
  "#profile=%E0%A4%A",
])("leaves any other fragment alone: %s", (hash) => {
  window.history.replaceState(null, "", `/${hash}`);
  expect(readAndScrubProfileEntry(window)).toBeUndefined();
  expect(window.location.hash).toBe(hash === "" ? "" : hash);
});
