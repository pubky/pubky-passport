import { describe, expect, it } from "vitest";

import { transitionIdentitySelection } from "./identitySelectionState";

describe("identity selection state", () => {
  it("opens and closes identity setup", () => {
    expect(transitionIdentitySelection({ view: "selection" }, { type: "add-requested" }))
      .toEqual({ view: "add-identity" });
    expect(transitionIdentitySelection({ view: "add-identity" }, { type: "add-cancelled" }))
      .toEqual({ view: "selection" });
  });

  it("ignores transitions that do not apply to the current view", () => {
    const selection = { view: "selection" } as const;
    const adding = { view: "add-identity" } as const;
    expect(transitionIdentitySelection(selection, { type: "add-cancelled" })).toBe(selection);
    expect(transitionIdentitySelection(adding, { type: "add-requested" })).toBe(adding);
  });
});
