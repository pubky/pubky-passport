import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getApplicationEnvironment } from "./applicationEnvironment";

describe("application environment", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", " google-client-id ");
    vi.stubEnv("HOMEGATE_URL", "https://homegate.example/api");
    vi.stubEnv(
      "PUBKY_HOMESERVER_CONNECT_ORIGINS",
      "https://homeserver.example/, https://migrated.example, https://homeserver.example",
    );
    vi.stubEnv("PASSPORT_SERVER_SECRET_BASE64", Buffer.alloc(32, 1).toString("base64"));
  });

  afterEach(() => vi.unstubAllEnvs());

  it("validates and normalizes the complete application configuration", () => {
    expect(getApplicationEnvironment()).toEqual({
      googleClientId: "google-client-id",
      homegateBaseUrl: "https://homegate.example/api/",
      homegateOrigin: "https://homegate.example",
      homeserverConnectOrigins: ["https://homeserver.example", "https://migrated.example"],
      serverSecretKeyring: {
        legacyV1Secret: Buffer.alloc(32, 1),
        currentKeyId: null,
        secretsByKeyId: new Map(),
      },
    });
  });

  it.each([
    "GOOGLE_CLIENT_ID",
    "HOMEGATE_URL",
    "PUBKY_HOMESERVER_CONNECT_ORIGINS",
    "PASSPORT_SERVER_SECRET_BASE64",
  ])("requires %s", (name) => {
    vi.stubEnv(name, undefined);

    expect(() => getApplicationEnvironment()).toThrow();
  });

  it("loads a bounded rotatable keyring while retaining the v1 secret", () => {
    const currentSecret = Buffer.alloc(32, 2);
    const previousSecret = Buffer.alloc(32, 3);
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "2026-08");
    vi.stubEnv("PASSPORT_SERVER_SECRET_KEYRING_JSON", JSON.stringify({
      "2026-07": previousSecret.toString("base64"),
      "2026-08": currentSecret.toString("base64"),
    }));

    expect(getApplicationEnvironment().serverSecretKeyring).toEqual({
      legacyV1Secret: Buffer.alloc(32, 1),
      currentKeyId: "2026-08",
      secretsByKeyId: new Map([
        ["2026-07", previousSecret],
        ["2026-08", currentSecret],
      ]),
    });
  });

  it("rejects incomplete or inconsistent keyring configuration", () => {
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "missing");
    vi.stubEnv("PASSPORT_SERVER_SECRET_KEYRING_JSON", JSON.stringify({ other: Buffer.alloc(32, 2).toString("base64") }));
    expect(() => getApplicationEnvironment()).toThrow();
  });
});
