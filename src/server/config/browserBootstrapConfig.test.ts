import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBrowserBootstrapConfig } from "./browserBootstrapConfig";

const VALID_CONFIG = {
  GOOGLE_CLIENT_ID: " google-client-id ",
  HOMEGATE_URL: "https://homegate.example/api",
  PUBKY_HOMESERVER_CONNECT_ORIGINS: "https://homeserver.example",
  PASSPORT_SERVER_SECRET_CURRENT_KEY_ID: "current",
  PASSPORT_SERVER_SECRET_KEYRING_JSON: JSON.stringify({
    current: Buffer.alloc(32, 1).toString("base64"),
  }),
};

describe("browser bootstrap config", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", VALID_CONFIG.GOOGLE_CLIENT_ID);
    vi.stubEnv("HOMEGATE_URL", VALID_CONFIG.HOMEGATE_URL);
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", VALID_CONFIG.PUBKY_HOMESERVER_CONNECT_ORIGINS);
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", VALID_CONFIG.PASSPORT_SERVER_SECRET_CURRENT_KEY_ID);
    vi.stubEnv("PASSPORT_SERVER_SECRET_KEYRING_JSON", VALID_CONFIG.PASSPORT_SERVER_SECRET_KEYRING_JSON);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("normalizes public browser values", () => {
    expect(getBrowserBootstrapConfig()).toEqual({
      googleClientId: "google-client-id",
      homegateBaseUrl: "https://homegate.example/api/",
      homegateOrigin: "https://homegate.example",
    });
  });

  it("requires the Google client ID", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", undefined);

    expect(() => getBrowserBootstrapConfig()).toThrow();
  });

  it.each([
    "not a URL",
    "http://homegate.example",
    "https://user:password@homegate.example",
    "https://homegate.example?unexpected=true",
    "https://homegate.example#fragment",
    "https://*.example.com",
    "https://homegate;source.example",
    "https://home_gate.example",
    "https://homegate..example",
    "https://192.0.2.1",
    "https://[2001:db8::1]",
    `https://${"a".repeat(64)}.example`,
    `https://${"a".repeat(2048)}.example`,
  ])("rejects an unsafe Homegate URL: %s", (homegateUrl) => {
    vi.stubEnv("HOMEGATE_URL", homegateUrl);

    expect(() => getBrowserBootstrapConfig()).toThrow();
  });
});
