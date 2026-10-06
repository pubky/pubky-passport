/** @vitest-environment jsdom */
import { afterEach, expect, it } from "vitest";
import { readAndScrubEditProfileEntry } from "./editProfileEntry";

const KEY = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

it("reads /#edit-profile=<key> and removes it from the address bar", () => {
  window.history.replaceState(null, "", `/#edit-profile=${KEY}`);
  expect(readAndScrubEditProfileEntry(window)).toEqual({ status: "edit", publicKeyZ32: KEY });
  expect(window.location.href).toBe(`${window.location.origin}/`);
});

it.each([
  "#edit-profile=",
  "#edit-profile=not-a-key",
  `#edit-profile=pubky${KEY}`,
  `#edit-profile=${KEY.toUpperCase()}`,
  `#edit-profile=${KEY}&edit-profile=${KEY}`,
  `#edit-profile=${KEY}&profile=required`,
  `#d=x&edit-profile=${KEY}`,
  `#edit-profile=${KEY}#x`,
  "#edit-profile=%E0%A4%A",
  "#edit-profile",
  `?edit-profile=${KEY}`,
  `?x=1#edit-profile=${KEY}`,
])("refuses any other shape of the link and still scrubs it: %s", (address) => {
  window.history.replaceState(null, "", `/${address}`);
  expect(readAndScrubEditProfileEntry(window)).toEqual({ status: "invalid" });
  expect(window.location.href).toBe(`${window.location.origin}/`);
});

it.each(["", `#profile=${KEY}`, "#d=x", "#edit=x", "?q=edit-profiles"])(
  "is not an edit link: %s",
  (address) => {
    window.history.replaceState(null, "", `/${address}`);
    expect(readAndScrubEditProfileEntry(window)).toBeUndefined();
    expect(window.location.href).toBe(`${window.location.origin}/${address}`);
  },
);
