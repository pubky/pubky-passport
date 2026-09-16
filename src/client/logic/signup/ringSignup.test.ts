import { DirectSignupDeepLink } from "@synonymdev/pubky";
import { describe, expect, it } from "vitest";

import { ringSignupUrl } from "./ringSignup";

const homeserverPubky = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";

describe("Ring signup URL", () => {
  it.each(["invite-token", "token with reserved characters: &?+#=%"])(
    "encodes a direct invite accepted by the SDK: %s",
    (signupToken) => {
      const url = ringSignupUrl({ homeserverPubky, signupToken });
      const parsed = DirectSignupDeepLink.parse(url);
      const homeserver = parsed.homeserver;
      try {
        expect(new URL(url).hostname).toBe("direct_signup");
        expect([...new URL(url).searchParams.keys()].sort()).toEqual(["hs", "st"]);
        expect(homeserver.z32()).toBe(homeserverPubky);
        expect(parsed.signupToken).toBe(signupToken);
      } finally {
        homeserver.free();
        parsed.free();
      }
    },
  );
});
