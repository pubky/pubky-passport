import { describe, expect, it } from "vitest";

import { transitionDetachFromGoogleFlow } from "./detachFromGoogleFlowState";

describe("detach from Google flow state", () => {
  it("models the backup gate and confirmation as one navigation state", () => {
    const review = transitionDetachFromGoogleFlow({ view: "backup" }, { type: "backup-confirmed" });
    expect(review).toEqual({ view: "review", confirmation: "closed" });
    expect(transitionDetachFromGoogleFlow(review, { type: "confirmation-requested" }))
      .toEqual({ view: "review", confirmation: "open" });
  });

  it("always closes nested state when returning to the backup gate", () => {
    expect(transitionDetachFromGoogleFlow(
      { view: "review", confirmation: "open" },
      { type: "back-to-backup" },
    )).toEqual({ view: "backup" });
  });

  it("keeps the one-shot migration payload only in the migration view", () => {
    expect(transitionDetachFromGoogleFlow(
      { view: "backup" },
      { type: "migration-requested", migrationUrl: "pubkyring://migration" },
    )).toEqual({ view: "pubky-ring", migrationUrl: "pubkyring://migration" });
  });
});
