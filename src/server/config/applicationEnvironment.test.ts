import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validateApplicationEnvironment } from "./applicationEnvironment";
import { getPublicApplicationEnvironment } from "./publicApplicationEnvironment";
import { getServerSecretEnvironment } from "./serverSecretEnvironment";

describe("application environment", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", " google-client-id ");
    vi.stubEnv("HOMEGATE_URL", "https://homegate.example/api");
    vi.stubEnv(
      "PUBKY_HOMESERVER_CONNECT_ORIGINS",
      "https://homeserver.example/, https://migrated.example, https://homeserver.example",
    );
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "current");
    vi.stubEnv(
      "PASSPORT_SERVER_SECRET_KEYRING_JSON",
      JSON.stringify({
        current: Buffer.alloc(32, 1).toString("base64"),
      }),
    );
  });

  afterEach(() => vi.unstubAllEnvs());

  it("validates and normalizes public and CSP configuration without server secrets", () => {
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", undefined);
    vi.stubEnv("PASSPORT_SERVER_SECRET_KEYRING_JSON", undefined);

    expect(getPublicApplicationEnvironment()).toEqual({
      googleClientId: "google-client-id",
      homegateBaseUrl: "https://homegate.example/api/",
      homegateOrigin: "https://homegate.example",
      homeserverConnectOrigins: ["https://homeserver.example", "https://migrated.example"],
    });
  });

  it("validates server secrets without public configuration", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", undefined);
    vi.stubEnv("HOMEGATE_URL", undefined);
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", undefined);

    expect(getServerSecretEnvironment()).toEqual({
      serverSecretCurrentKeyId: "current",
      serverSecrets: new Map([["current", Buffer.alloc(32, 1)]]),
    });
  });

  it("caches the two configuration boundaries independently", () => {
    const publicEnvironment = getPublicApplicationEnvironment();
    const secretEnvironment = getServerSecretEnvironment();

    expect(getPublicApplicationEnvironment()).toBe(publicEnvironment);
    expect(getServerSecretEnvironment()).toBe(secretEnvironment);

    vi.stubEnv("PASSPORT_SERVER_SECRET_KEYRING_JSON", "invalid");
    expect(getPublicApplicationEnvironment()).toBe(publicEnvironment);
    expect(() => getServerSecretEnvironment()).toThrow();
  });

  it("composes both boundaries for startup validation", () => {
    expect(validateApplicationEnvironment()).toBeUndefined();

    vi.stubEnv("PASSPORT_SERVER_SECRET_KEYRING_JSON", "invalid");
    expect(() => validateApplicationEnvironment()).toThrow(
      "PASSPORT_SERVER_SECRET_KEYRING_JSON must be valid JSON",
    );
  });

  it.each(["GOOGLE_CLIENT_ID", "HOMEGATE_URL", "PUBKY_HOMESERVER_CONNECT_ORIGINS"])(
    "requires public value %s",
    (name) => {
      vi.stubEnv(name, undefined);

      expect(() => getPublicApplicationEnvironment()).toThrow();
    },
  );

  it.each(["PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "PASSPORT_SERVER_SECRET_KEYRING_JSON"])(
    "requires secret value %s",
    (name) => {
      vi.stubEnv(name, undefined);

      expect(() => getServerSecretEnvironment()).toThrow();
    },
  );

  it("loads current and retained server secrets", () => {
    const currentSecret = Buffer.alloc(32, 2);
    const previousSecret = Buffer.alloc(32, 3);
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "2026-08");
    vi.stubEnv(
      "PASSPORT_SERVER_SECRET_KEYRING_JSON",
      JSON.stringify({
        "2026-07": previousSecret.toString("base64"),
        "2026-08": currentSecret.toString("base64"),
      }),
    );

    expect(getServerSecretEnvironment()).toEqual({
      serverSecretCurrentKeyId: "2026-08",
      serverSecrets: new Map([
        ["2026-07", previousSecret],
        ["2026-08", currentSecret],
      ]),
    });
  });

  it("rejects incomplete or inconsistent keyring configuration", () => {
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "missing");
    vi.stubEnv(
      "PASSPORT_SERVER_SECRET_KEYRING_JSON",
      JSON.stringify({
        other: Buffer.alloc(32, 2).toString("base64"),
      }),
    );

    expect(() => getServerSecretEnvironment()).toThrow();
  });

  it("rejects a decoded secret larger than the per-secret limit", () => {
    vi.stubEnv(
      "PASSPORT_SERVER_SECRET_KEYRING_JSON",
      JSON.stringify({
        current: Buffer.alloc(65, 1).toString("base64"),
      }),
    );

    expect(() => getServerSecretEnvironment()).toThrow(
      "Passport server keyring contains an invalid secret",
    );
  });

  it("rejects a keyring larger than the total decoded-secret limit", () => {
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "key-0");
    vi.stubEnv(
      "PASSPORT_SERVER_SECRET_KEYRING_JSON",
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 16 }, (_, index) => [
            `key-${index}`,
            Buffer.alloc(33, index).toString("base64"),
          ]),
        ),
      ),
    );

    expect(() => getServerSecretEnvironment()).toThrow(
      "Passport server keyring exceeds its maximum decoded size",
    );
  });

  it("accepts a keyring at the decoded-secret size limits", () => {
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "key-0");
    vi.stubEnv(
      "PASSPORT_SERVER_SECRET_KEYRING_JSON",
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 8 }, (_, index) => [
            `key-${index}`,
            Buffer.alloc(64, index).toString("base64"),
          ]),
        ),
      ),
    );

    expect(getServerSecretEnvironment().serverSecrets).toHaveLength(8);
  });
});
