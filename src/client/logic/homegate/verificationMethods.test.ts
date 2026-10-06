import { describe, expect, it } from "vitest";

import type { MethodAvailability } from "./HomegateAvailabilityClient";
import { invitesOnly, verifiesWithoutInvite } from "./verificationMethods";

type Status = MethodAvailability["status"];

const STATUSES: readonly Status[] = ["checking", "available", "unavailable", "blocked", "unknown"];

function methods(sms: Status, lightning: Status) {
  return { sms: { status: sms }, lightning: { status: lightning } };
}

describe("invitesOnly", () => {
  it("holds only when the instance offers neither SMS nor Lightning", () => {
    expect(invitesOnly(methods("unavailable", "unavailable"))).toBe(true);
  });

  it.each(
    STATUSES.flatMap((sms) => STATUSES.map((lightning) => [sms, lightning] as const)).filter(
      ([sms, lightning]) => sms !== "unavailable" || lightning !== "unavailable",
    ),
  )("does not hold for SMS %s and Lightning %s, which may yet be offered", (sms, lightning) => {
    expect(invitesOnly(methods(sms, lightning))).toBe(false);
  });
});

describe("verifiesWithoutInvite", () => {
  it.each(["checking", "unavailable", "blocked", "unknown"] as const)(
    "holds when SMS is available and Lightning %s, and the other way round",
    (other) => {
      expect(verifiesWithoutInvite(methods("available", other))).toBe(true);
      expect(verifiesWithoutInvite(methods(other, "available"))).toBe(true);
    },
  );

  it.each(
    (["checking", "unavailable", "blocked", "unknown"] as const).flatMap((sms) =>
      (["checking", "unavailable", "blocked", "unknown"] as const).map(
        (lightning) => [sms, lightning] as const,
      ),
    ),
  )("does not hold for SMS %s and Lightning %s", (sms, lightning) => {
    expect(verifiesWithoutInvite(methods(sms, lightning))).toBe(false);
  });
});
