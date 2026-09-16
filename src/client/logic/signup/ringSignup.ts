import type { HomeserverSignupDetails } from "@/client/logic/homegate/homegateSignup";

/** Ring's Add Pubky scanner accepts a direct signup invite, without a client grant. */
export function ringSignupUrl(invite: HomeserverSignupDetails): string {
  return `pubkyauth://direct_signup?${new URLSearchParams({
    hs: invite.homeserverPubky,
    st: invite.signupToken,
  })}`;
}
