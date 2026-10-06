import { describe, expect, it, vi } from "vitest";

import { isRequestPending, PendingRequestPresence } from "./pendingRequestPresence";

const review = { authenticationMethod: "cookie", capabilities: [] } as const;

describe("pending request presence", () => {
  it("counts a request as pending until it has its answer", () => {
    for (const status of ["review", "preparing", "granting"] as const)
      expect(isRequestPending({ status, review })).toBe(true);
    expect(isRequestPending({ status: "completing", review, outcome: "cancel" })).toBe(true);
    for (const status of ["manual-entry", "invalid", "expired"] as const)
      expect(isRequestPending({ status })).toBe(false);
    for (const status of ["approved", "handed-off", "cancelled"] as const)
      expect(isRequestPending({ status, review })).toBe(false);
    expect(isRequestPending({ status: "failed", review, reason: "delivery" })).toBe(false);
    expect(isRequestPending(undefined)).toBe(false);
  });

  it("is unknown until published, and notifies only on a change", () => {
    const presence = new PendingRequestPresence();
    const listener = vi.fn();
    const unsubscribe = presence.subscribe(listener);
    expect(presence.read()).toBeUndefined();

    presence.publish(true);
    presence.publish(true);
    presence.publish(false);
    expect(presence.read()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    presence.publish(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
