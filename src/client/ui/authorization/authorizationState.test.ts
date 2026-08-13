import { describe, expect, it } from "vitest";

import { transitionAuthorizationView } from "./authorizationState";

describe("authorization view state", () => {
  it("opens and finishes identity selection", () => {
    expect(transitionAuthorizationView({ view: "review" }, { type: "switch-requested" }))
      .toEqual({ view: "identity-selection" });
    expect(transitionAuthorizationView({ view: "identity-selection" }, { type: "selection-finished" }))
      .toEqual({ view: "review" });
  });

  it("ignores events that do not apply to the current view", () => {
    const review = { view: "review" } as const;
    const selection = { view: "identity-selection" } as const;
    expect(transitionAuthorizationView(review, { type: "selection-finished" })).toBe(review);
    expect(transitionAuthorizationView(selection, { type: "switch-requested" })).toBe(selection);
  });
});
