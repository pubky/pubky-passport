import "client-only";

import type { VerificationAvailability } from "./HomegateAvailabilityClient";

type SignupMethods = Pick<VerificationAvailability, "sms" | "lightning">;

/**
 * Whether an invite is the only way to verify a new account: this instance offers neither SMS
 * nor Lightning (not configured, or its Homegate has no such route). A method still being checked
 * or whose check failed may yet be offered, so it does not count as missing.
 */
export function invitesOnly(methods: SignupMethods): boolean {
  return methods.sms.status === "unavailable" && methods.lightning.status === "unavailable";
}

/**
 * Whether SMS or Lightning can verify a new account right now, so there is another way to offer
 * when an invite is refused. Blocked, unknown and still-checking methods cannot.
 */
export function verifiesWithoutInvite(methods: SignupMethods): boolean {
  return methods.sms.status === "available" || methods.lightning.status === "available";
}
