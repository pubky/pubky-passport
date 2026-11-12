import { describe, expect, it } from "vitest";

import { appleIdentityErrorMessage } from "./appleIdentityErrorMessage";

describe("appleIdentityErrorMessage", () => {
  it("says the iCloud backup is unchanged when a restored identity has no homeserver record", () => {
    expect(appleIdentityErrorMessage("homeserver_not_found")).toBe(
      "Passport couldn't find this pubky's homeserver record. Your backup in iCloud is unchanged. Open the app that manages this pubky so it republishes its homeserver, then try again.",
    );
  });
});
