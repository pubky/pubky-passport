import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPublicEnvironment, getServerEnvironment } from "./environment";

describe("environment", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", " google-client-id ");
    vi.stubEnv("HOMEGATE_URL", "https://homegate.example");
    vi.stubEnv(
      "PUBKY_HOMESERVER_CONNECT_ORIGINS",
      "https://homeserver.example/, https://migrated.example, https://homeserver.example",
    );
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "current");
    vi.stubEnv(
      "PASSPORT_SERVER_SECRET_KEYRING_JSON",
      JSON.stringify({ current: Buffer.alloc(32, 1).toString("base64") }),
    );
  });

  afterEach(() => vi.unstubAllEnvs());

  it("reads and normalizes public configuration without reading server secrets", () => {
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", undefined);
    vi.stubEnv("PASSPORT_SERVER_SECRET_KEYRING_JSON", "not-json");

    expect(getPublicEnvironment()).toEqual({
      googleClientId: "google-client-id",
      homegateBaseUrl: "https://homegate.example/",
      homegateOrigin: "https://homegate.example",
      homeserverConnectOrigins: ["https://homeserver.example", "https://migrated.example"],
    });
  });

  it("reads current and retained secrets without reading public configuration", () => {
    const previous = Buffer.alloc(32, 2);
    vi.stubEnv("GOOGLE_CLIENT_ID", undefined);
    vi.stubEnv("HOMEGATE_URL", undefined);
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", undefined);
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "current");
    vi.stubEnv(
      "PASSPORT_SERVER_SECRET_KEYRING_JSON",
      JSON.stringify({
        previous: previous.toString("base64"),
        current: Buffer.alloc(32, 1).toString("base64"),
      }),
    );

    expect(getServerEnvironment()).toEqual({
      currentKeyId: "current",
      secrets: new Map([
        ["previous", previous],
        ["current", Buffer.alloc(32, 1)],
      ]),
    });
  });

  it.each(["GOOGLE_CLIENT_ID", "HOMEGATE_URL", "PUBKY_HOMESERVER_CONNECT_ORIGINS"])(
    "requires %s",
    (name) => {
      vi.stubEnv(name, undefined);
      expect(() => getPublicEnvironment()).toThrow(`${name} is required`);
    },
  );

  it.each(["PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "PASSPORT_SERVER_SECRET_KEYRING_JSON"])(
    "requires %s",
    (name) => {
      vi.stubEnv(name, undefined);
      expect(() => getServerEnvironment()).toThrow(`${name} is required`);
    },
  );

  it.each([
    ["HOMEGATE_URL", "http://homegate.example"],
    ["HOMEGATE_URL", "https://user:password@homegate.example"],
    ["HOMEGATE_URL", "https://homegate.example/api"],
    ["HOMEGATE_URL", "https://*.example.com"],
    ["PUBKY_HOMESERVER_CONNECT_ORIGINS", "https://homeserver.example/path"],
  ])("rejects unsafe %s values", (name, value) => {
    vi.stubEnv(name, value);
    expect(() => getPublicEnvironment()).toThrow();
  });

  it.each(["not-json", "null", "[]"])("rejects an invalid keyring: %s", (keyring) => {
    vi.stubEnv("PASSPORT_SERVER_SECRET_KEYRING_JSON", keyring);
    expect(() => getServerEnvironment()).toThrow();
  });

  it.each([
    Buffer.alloc(31, 1).toString("base64"),
    "not-base64!",
    Buffer.alloc(32, 255).toString("base64url"),
  ])("rejects an invalid server secret", (secret) => {
    vi.stubEnv("PASSPORT_SERVER_SECRET_KEYRING_JSON", JSON.stringify({ current: secret }));
    expect(() => getServerEnvironment()).toThrow(
      "Passport server keyring contains an invalid secret",
    );
  });

  it("requires the current key to exist", () => {
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "missing");
    expect(() => getServerEnvironment()).toThrow(
      "Passport server keyring does not contain its current key ID",
    );
  });

  it("accepts operator-managed keyrings without arbitrary size limits", () => {
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "key-0");
    vi.stubEnv(
      "PASSPORT_SERVER_SECRET_KEYRING_JSON",
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 40 }, (_, index) => [
            `key-${index}`,
            Buffer.alloc(index === 0 ? 128 : 32, index).toString("base64"),
          ]),
        ),
      ),
    );

    const environment = getServerEnvironment();
    expect(environment.secrets).toHaveLength(40);
    expect(environment.secrets.get("key-0")).toHaveLength(128);
  });
});
