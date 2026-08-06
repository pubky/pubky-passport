import { afterEach, describe, expect, it, vi } from "vitest";

import { getGoogleOAuthClientConfig } from "./googleOAuthClient";

describe("Google OAuth client config", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the client secret in server configuration", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    expect(getGoogleOAuthClientConfig()).toEqual({ clientId: "client-id", clientSecret: "client-secret" });
  });

  it("requires the client secret", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", undefined);
    expect(() => getGoogleOAuthClientConfig()).toThrow();
  });
});
