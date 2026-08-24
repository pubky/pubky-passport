import { describe, expect, it } from "vitest";

import {
  type GoogleIdentityError,
} from "../../../logic/google-identity/GoogleIdentityController";
import { toGoogleIdentityViewError } from "../../../logic/google-identity/googleIdentityViewError";
import {
  INITIAL_GOOGLE_IDENTITY_ESTABLISHMENT_STATE,
  transitionGoogleIdentityEstablishment,
  type GoogleIdentityEstablishmentEvent,
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

  it("copies only allowlisted error fields into reducer state", () => {
    const error = toGoogleIdentityViewError({
      code: "homeserver_signup_invitation_failed",
      detailCode: "weekly_limit_exceeded",
      cause: { secret: "REDUCER-CAUSE-CANARY" },
    } satisfies GoogleIdentityError);
    const event = {
      type: "operation-failed",
      error,
    } satisfies GoogleIdentityEstablishmentEvent;

    const state = transitionGoogleIdentityEstablishment(
      INITIAL_GOOGLE_IDENTITY_ESTABLISHMENT_STATE,
      event,
    );

    expect(state).toEqual({
      view: {
        status: "failed",
        error: {
          code: "homeserver_signup_invitation_failed",
          detailCode: "weekly_limit_exceeded",
        },
      },
    });
    expect(JSON.stringify(state)).not.toContain("REDUCER-CAUSE-CANARY");
  });
});
