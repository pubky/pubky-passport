import { describe, expect, it } from "vitest";

import { parseBrowserBootstrapConfig } from "./browserBootstrapConfig";

const validConfig = {
  GOOGLE_CLIENT_ID: "google-client-id",
  HOMEGATE_URL: "https://homegate.example/api",
};

describe("browser bootstrap config", () => {
  it("normalizes public browser values", () => {
    expect(parseBrowserBootstrapConfig(validConfig)).toEqual({
      googleClientId: "google-client-id",
      homegateBaseUrl: "https://homegate.example/api/",
      homegateOrigin: "https://homegate.example",
    });
  });

  it("requires the Google client ID", () => {
    expect(() => parseBrowserBootstrapConfig({ ...validConfig, GOOGLE_CLIENT_ID: undefined })).toThrow();
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
    expect(() => parseBrowserBootstrapConfig({ ...validConfig, HOMEGATE_URL: homegateUrl })).toThrow();
  });
});
