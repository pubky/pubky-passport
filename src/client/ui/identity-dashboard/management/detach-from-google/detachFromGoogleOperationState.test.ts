import { describe, expect, it } from "vitest";

import { transitionDetachFromGoogleOperation } from "./detachFromGoogleOperationState";

describe("detach from Google operation state", () => {
  it("distinguishes authorization and deletion failures", () => {
    expect(transitionDetachFromGoogleOperation({ name: "ready" }, { type: "authorization-failed" }))
      .toEqual({ name: "authorization-failed" });
    expect(transitionDetachFromGoogleOperation(
      { name: "deleting-backup" },
      { type: "operation-failed", error: { code: "backup_deletion_failed" } },
    )).toEqual({ name: "operation-failed", error: { code: "backup_deletion_failed" } });
  });

  it("reports completion after backup deletion", () => {
    expect(transitionDetachFromGoogleOperation(
      { name: "deleting-backup" },
      { type: "operation-completed" },
    )).toEqual({ name: "complete" });
  });
});
