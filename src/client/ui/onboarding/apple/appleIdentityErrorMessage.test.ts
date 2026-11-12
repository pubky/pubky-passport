import { describe, expect, it } from "vitest";

import { googleIdentityErrorMessage } from "@/client/ui/googleIdentityErrorMessage";
import { importErrorMessage } from "@/client/ui/onboarding/import-identity/importErrorMessage";
import { appleIdentityErrorMessage } from "./appleIdentityErrorMessage";

describe("appleIdentityErrorMessage", () => {
  it("uses the import's copy when a restored identity has no homeserver", () => {
    const copy = importErrorMessage("homeserver_not_found");

    expect(copy).toBe(
      "This pubky has no homeserver, so Passport cannot sign in with it. Nothing was saved.",
    );
    expect(appleIdentityErrorMessage("homeserver_not_found")).toBe(copy);
    expect(googleIdentityErrorMessage("homeserver_not_found")).toBe(copy);
  });
});
