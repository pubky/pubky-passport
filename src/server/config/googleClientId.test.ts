import { describe, expect, it } from "vitest";

import { parseGoogleClientId } from "./googleClientId";

describe("Google client ID config", () => {
  it("parses the browser and server token audience without unrelated config", () => {
    expect(parseGoogleClientId({ GOOGLE_CLIENT_ID: " google-client-id " })).toBe("google-client-id");
  });

  it("rejects a missing Google client ID", () => {
    expect(() => parseGoogleClientId({})).toThrow();
  });
});
