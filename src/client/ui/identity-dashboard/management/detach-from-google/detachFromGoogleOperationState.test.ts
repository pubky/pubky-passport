import { describe, expect, it } from "vitest";

import { transitionDetachFromGoogleOperation } from "./detachFromGoogleOperationState";

describe("detach from Google operation state", () => {
  it("distinguishes authorization and deletion failures", () => {
    expect(transitionDetachFromGoogleOperation({ name: "preparing" }, { type: "authorization-failed" }))
      .toEqual({ name: "authorization-failed" });
    expect(transitionDetachFromGoogleOperation({ name: "deleting-backup" }, { type: "operation-failed" }))
      .toEqual({ name: "operation-failed" });
  });

  it("does not let the controller authorization reset overwrite deletion progress", () => {
    const deleting = { name: "deleting-backup" } as const;
    expect(transitionDetachFromGoogleOperation(deleting, { type: "authorization-ready" })).toBe(deleting);
  });
});
