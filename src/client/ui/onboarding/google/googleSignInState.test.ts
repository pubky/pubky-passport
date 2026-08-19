import { describe, expect, it } from "vitest";

import { INITIAL_GOOGLE_SIGN_IN_STATE, transitionGoogleSignIn } from "./googleSignInState";

describe("Google sign-in state", () => {
  it("tracks the operation and returns to the idle view", () => {
    const requesting = transitionGoogleSignIn(INITIAL_GOOGLE_SIGN_IN_STATE, { type: "request-started" });
    const working = transitionGoogleSignIn(requesting, {
      type: "progress-reported",
      progress: { flow: "lookup", step: "checking" },
    });

    expect(working).toEqual({
      view: { name: "working", progress: { flow: "lookup", step: "checking" } },
    });
    expect(transitionGoogleSignIn(working, { type: "back" }))
      .toEqual({ view: { name: "idle" } });
  });

  it("shows a recoverable authorization denial", () => {
    expect(transitionGoogleSignIn(INITIAL_GOOGLE_SIGN_IN_STATE, { type: "authorization-denied" }))
      .toEqual({ view: { name: "denied" } });
  });
});
