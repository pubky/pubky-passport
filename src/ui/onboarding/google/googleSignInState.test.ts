import { describe, expect, it } from "vitest";

import { INITIAL_GOOGLE_SIGN_IN_STATE, transitionGoogleSignIn } from "./googleSignInState";

describe("Google sign-in state", () => {
  it("preserves authorization readiness across the operation", () => {
    const ready = transitionGoogleSignIn(INITIAL_GOOGLE_SIGN_IN_STATE, { type: "authorization-ready" });
    const requesting = transitionGoogleSignIn(ready, { type: "request-started" });
    const working = transitionGoogleSignIn(requesting, { type: "progress-reported", progress: "checking_passport_file" });

    expect(working).toEqual({
      authorizationReady: true,
      view: { name: "working", progress: "checking_passport_file" },
    });
    expect(transitionGoogleSignIn(working, { type: "back" }))
      .toEqual({ authorizationReady: true, view: { name: "idle" } });
  });

  it("does not replace operation progress when the controller resets authorization", () => {
    const working = {
      authorizationReady: true,
      view: { name: "working", progress: "restoring_identity" },
    } as const;
    expect(transitionGoogleSignIn(working, { type: "authorization-ready" })).toEqual(working);
  });
});
