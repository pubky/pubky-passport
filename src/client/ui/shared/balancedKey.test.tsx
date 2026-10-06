/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BALANCED_KEY_CLASS, BalancedKeyText, balancedHalves } from "./balancedKey";

const KEY = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";

describe("balancedHalves", () => {
  it("splits a 52-character key 26/26 and an odd length with the longer half first", () => {
    expect(balancedHalves(KEY).map((half) => half.length)).toEqual([26, 26]);
    expect(balancedHalves(KEY).join("")).toBe(KEY);
    expect(balancedHalves("abcde")).toEqual(["abc", "de"]);
    expect(balancedHalves("")).toEqual(["", ""]);
  });
});

describe("BalancedKeyText", () => {
  afterEach(cleanup);

  it("is the exact key, with one break opportunity at its middle and nothing added", () => {
    render(
      <p className={BALANCED_KEY_CLASS} data-testid="key">
        <BalancedKeyText value={KEY} />
      </p>,
    );
    const element = screen.getByTestId("key");
    // Found by the key itself: the halves are text nodes of this element.
    expect(screen.getByText(KEY)).toBe(element);
    expect(element.textContent).toBe(KEY);
    expect(element.innerHTML).toBe(`${KEY.slice(0, 26)}<wbr>${KEY.slice(26)}`);
    // Selecting the element and copying gives the key with no inserted character.
    const range = document.createRange();
    range.selectNodeContents(element);
    expect(range.toString()).toBe(KEY);
    // No class makes the browser break elsewhere in the key.
    expect(BALANCED_KEY_CLASS).not.toMatch(/break-all|anywhere/u);
    expect(element).toHaveClass("[word-break:normal]", "[overflow-wrap:break-word]");
  });
});
