import { describe, expect, it } from "vitest";

import {
  INITIAL_GOOGLE_IDENTITY_ESTABLISHMENT_STATE,
  transitionGoogleIdentityEstablishment,
} from "./googleIdentityEstablishmentState";

describe("Google identity establishment state", () => {
  it("tracks the operation and returns to the idle view", () => {
    const requesting = transitionGoogleIdentityEstablishment(INITIAL_GOOGLE_IDENTITY_ESTABLISHMENT_STATE, { type: "request-started" });
    const working = transitionGoogleIdentityEstablishment(requesting, {
      type: "progress-reported",
      progress: { flow: "lookup", step: "checking" },
    });

    expect(working).toEqual({
      view: { status: "working", progress: { flow: "lookup", step: "checking" } },
    });
    expect(transitionGoogleIdentityEstablishment(working, { type: "back" }))
      .toEqual({ view: { status: "idle" } });
  });

});
