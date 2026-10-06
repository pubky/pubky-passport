import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubPassportEnvironment } from "@test-utils/passportEnvironment";
import { getPublicEnvironment, getServerEnvironment } from "./environment";

const PROVIDER_HOMESERVER = "tkrq8zmwb8a3m9k15csu3q17qmfgqnp9dskbrg9uq1rydpyxp7qy";

describe("environment", () => {
  beforeEach(() => {
    stubPassportEnvironment({ GOOGLE_CLIENT_ID: " google-client-id " });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("supports an invite-only provider without Google or Homegate credentials", () => {
    stubPassportEnvironment({
      PASSPORT_PROVIDER_CONFIG_JSON: JSON.stringify({
        googleEnabled: false,
        verificationMethods: ["invite"],
        storageDescription: "2 GB included",
        termsUrl: "https://provider.example/terms",
      }),
      PUBKY_SIGNUP_HOMESERVER: PROVIDER_HOMESERVER,
      GOOGLE_CLIENT_ID: undefined,
      HOMEGATE_URL: undefined,
    });
    expect(getPublicEnvironment()).toMatchObject({
      googleClientId: "",
      homegateBaseUrl: "",
      homegateOrigin: null,
      instance: {
        features: { google: false },
        verificationMethods: ["invite"],
        homeserver: PROVIDER_HOMESERVER,
      },
    });
  });

  it("keeps Google off when the provider disables it, even with a client ID", () => {
    stubPassportEnvironment({
      PASSPORT_PROVIDER_CONFIG_JSON: JSON.stringify({
        googleEnabled: false,
        verificationMethods: ["invite"],
      }),
      HOMEGATE_URL: undefined,
    });
    expect(getPublicEnvironment()).toMatchObject({
      googleClientId: "",
      homegateBaseUrl: "",
      instance: { features: { google: false } },
    });
  });

  it("requires Homegate for an invite-only provider that keeps Google", () => {
    stubPassportEnvironment({
      PASSPORT_PROVIDER_CONFIG_JSON: JSON.stringify({ verificationMethods: ["invite"] }),
      HOMEGATE_URL: undefined,
    });
    expect(() => getPublicEnvironment()).toThrow("HOMEGATE_URL is required.");
  });

  it.each([undefined, " "])("turns Google off when no client ID is configured: %j", (clientId) => {
    stubPassportEnvironment({ GOOGLE_CLIENT_ID: clientId });
    expect(getPublicEnvironment()).toMatchObject({
      googleClientId: "",
      instance: { features: { google: false } },
    });
  });

  it("fails startup when Google is enabled explicitly without a client ID", () => {
    stubPassportEnvironment({
      PASSPORT_PROVIDER_CONFIG_JSON: JSON.stringify({ googleEnabled: true }),
      GOOGLE_CLIENT_ID: " ",
    });
    expect(() => getPublicEnvironment()).toThrow(
      "GOOGLE_CLIENT_ID is required when Google is enabled.",
    );
  });

  it.each([undefined, " "])(
    "defaults a missing provider configuration to every method: %j",
    (configuration) => {
      stubPassportEnvironment({ PASSPORT_PROVIDER_CONFIG_JSON: configuration });
      expect(getPublicEnvironment().instance).toEqual({
        verificationMethods: ["lightning", "sms", "invite"],
        features: { google: true },
        homeserver: null,
        httpRelay: "https://httprelay.pubky.app/inbox",
        network: { network: "mainnet" },
      });
    },
  );

  it.each([
    [undefined, undefined],
    [" ", undefined],
    [
      " ",
      JSON.stringify({
        verificationMethods: ["invite"],
        storageDescription: "2 GB",
        upgradeUrl: "https://acme.example/storage",
      }),
    ],
  ])(
    "has no provider homeserver unless PUBKY_SIGNUP_HOMESERVER names one: %j",
    (homeserver, configuration) => {
      stubPassportEnvironment({
        PASSPORT_PROVIDER_CONFIG_JSON: configuration,
        PUBKY_SIGNUP_HOMESERVER: homeserver,
      });
      expect(getPublicEnvironment().instance.homeserver).toBeNull();
    },
  );

  it("trims a configured provider homeserver", () => {
    stubPassportEnvironment({ PUBKY_SIGNUP_HOMESERVER: ` ${PROVIDER_HOMESERVER} ` });
    expect(getPublicEnvironment().instance.homeserver).toBe(PROVIDER_HOMESERVER);
  });

  it.each([
    "pubky://tkrq8zmwb8a3m9k15csu3q17qmfgqnp9dskbrg9uq1rydpyxp7qy",
    "TKRQ8ZMWB8A3M9K15CSU3Q17QMFGQNP9DSKBRG9UQ1RYDPYXP7QY",
    "homeserver.example",
  ])("rejects a non-canonical provider homeserver: %s", (homeserver) => {
    stubPassportEnvironment({ PUBKY_SIGNUP_HOMESERVER: homeserver });
    expect(() => getPublicEnvironment()).toThrow(
      "PUBKY_SIGNUP_HOMESERVER must be a z-base-32 Pubky public key.",
    );
  });

  it.each([
    [{ termsUrl: "javascript:alert(1)" }, "termsUrl: custom"],
    [{ upgradeUrl: "https://user:password@example.com" }, "upgradeUrl: custom"],
    [{ verificationMethods: ["sms", "sms"] }, "verificationMethods: custom"],
    [{ verificationMethods: [] }, "verificationMethods: too_small"],
    [{ googleEnabled: "yes" }, "googleEnabled: invalid_type"],
    [{ serverSecret: "SECRET-CONFIG-CANARY" }, "(root): unrecognized_keys"],
    // Retired settings: Passport names no provider, and every invite may name its homeserver.
    [{ name: "Acme" }, "(root): unrecognized_keys"],
    [{ allowCustomHomeserver: true }, "(root): unrecognized_keys"],
  ])(
    "rejects invalid provider configuration by path without echoing it",
    (configuration, issue) => {
      stubPassportEnvironment({ PASSPORT_PROVIDER_CONFIG_JSON: JSON.stringify(configuration) });
      const error = captureError(() => getPublicEnvironment());
      expect(error.message).toMatch(/^PASSPORT_PROVIDER_CONFIG_JSON is invalid \(.+\)\.$/u);
      expect(error.message).toContain(issue);
      expect(error).not.toHaveProperty("cause");
      for (const value of Object.values(configuration).flat()) {
        if (typeof value === "string" && value) expect(String(error)).not.toContain(value);
      }
      expect(String(error)).not.toContain("serverSecret");
    },
  );

  it("rejects malformed provider JSON without echoing it", () => {
    stubPassportEnvironment({ PASSPORT_PROVIDER_CONFIG_JSON: "{SECRET-CONFIG-CANARY" });
    const error = captureError(() => getPublicEnvironment());
    expect(error.message).toBe("PASSPORT_PROVIDER_CONFIG_JSON must be valid JSON.");
    expect(error).not.toHaveProperty("cause");
    expect(String(error)).not.toContain("SECRET-CONFIG-CANARY");
  });

  it("reads and normalizes public configuration without reading server secrets", () => {
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", undefined);
    vi.stubEnv("PASSPORT_SERVER_SECRET_KEYRING_JSON", "not-json");

    expect(getPublicEnvironment()).toEqual({
      googleClientId: "google-client-id",
      homegateBaseUrl: "https://homegate.example/",
      homegateOrigin: "https://homegate.example",
      instance: {
        verificationMethods: ["lightning", "sms", "invite"],
        features: { google: true },
        homeserver: null,
        httpRelay: "https://httprelay.pubky.app/inbox",
        network: { network: "mainnet" },
      },
      networkConnectSources: { all: [], signer: [] },
    });
  });

  it("reads the configured HTTP relay for Passport's own grants", () => {
    stubPassportEnvironment({ PUBKY_HTTP_RELAY_URL: " https://relay.provider.example/inbox " });
    expect(getPublicEnvironment()).toMatchObject({
      instance: { httpRelay: "https://relay.provider.example/inbox" },
    });
  });

  it.each([
    "http://relay.provider.example/inbox",
    "https://user:password@relay.provider.example/inbox",
    "https://relay.provider.example/inbox?token=RELAY-CANARY",
    "https://relay.provider.example/inbox#RELAY-CANARY",
    "https://*.provider.example/inbox",
    "https://192.0.2.1/inbox",
    "relay.provider.example/inbox",
  ])("rejects an unsafe HTTP relay without echoing it: %s", (relay) => {
    stubPassportEnvironment({ PUBKY_HTTP_RELAY_URL: relay });
    const error = captureError(() => getPublicEnvironment());
    expect(error.message).toBe("PUBKY_HTTP_RELAY_URL must be a valid HTTPS URL.");
    expect(error.message).not.toContain(relay);
  });

  it("reads current and retained secrets without reading public configuration", () => {
    const previous = Buffer.alloc(32, 2);
    vi.stubEnv("GOOGLE_CLIENT_ID", undefined);
    vi.stubEnv("HOMEGATE_URL", undefined);
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

  it("requires HOMEGATE_URL", () => {
    vi.stubEnv("HOMEGATE_URL", undefined);
    expect(() => getPublicEnvironment()).toThrow("HOMEGATE_URL is required");
  });

  it("no longer reads the retired homeserver origin list", () => {
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", "https://homeserver.example/path");
    expect(getPublicEnvironment()).not.toHaveProperty("homeserverConnectOrigins");
  });

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
    ["HOMEGATE_URL", "https://homegate.example/api?key=1"],
    ["HOMEGATE_URL", "https://*.example.com"],
  ])("rejects unsafe %s values", (name, value) => {
    vi.stubEnv(name, value);
    expect(() => getPublicEnvironment()).toThrow();
  });

  it.each([
    ["https://gateway.example/_pubky/homegate", "https://gateway.example/_pubky/homegate/"],
    ["https://gateway.example/_pubky/homegate/", "https://gateway.example/_pubky/homegate/"],
  ])("takes Homegate under a path prefix: %s", (configured, base) => {
    stubPassportEnvironment({ HOMEGATE_URL: configured });
    expect(getPublicEnvironment()).toMatchObject({
      homegateBaseUrl: base,
      homegateOrigin: "https://gateway.example",
    });
  });

  describe("network", () => {
    const TESTNET = {
      PUBKY_NETWORK: "testnet",
      PUBKY_TESTNET_PKARR_RELAYS: "https://gateway.example/_pubky/pkarr/, http://localhost:15411",
      PUBKY_TESTNET_HTTP_RELAY: "https://gateway.example/_pubky/relay/inbox",
    };

    it.each([undefined, " ", "mainnet"])("is mainnet, exactly as before, for %j", (network) => {
      stubPassportEnvironment({ PUBKY_NETWORK: network });
      expect(getPublicEnvironment()).toMatchObject({
        instance: {
          network: { network: "mainnet" },
          httpRelay: "https://httprelay.pubky.app/inbox",
        },
        networkConnectSources: { all: [], signer: [] },
      });
    });

    it("reads a testnet's relays, rewrites and the sources CSP needs for them", () => {
      stubPassportEnvironment({
        ...TESTNET,
        PUBKY_TESTNET_URL_REWRITES_JSON: JSON.stringify({
          "http://localhost:6286/": "https://gateway.example/_pubky/homeserver/",
          "https://app.example/_pubky/relay": "http://127.0.0.1:15412",
        }),
      });
      expect(getPublicEnvironment()).toMatchObject({
        instance: {
          httpRelay: "https://gateway.example/_pubky/relay/inbox",
          network: {
            network: "testnet",
            pkarrRelays: ["https://gateway.example/_pubky/pkarr", "http://localhost:15411"],
            rewrites: [
              { from: "http://localhost:6286", to: "https://gateway.example/_pubky/homeserver" },
              { from: "https://app.example/_pubky/relay", to: "http://127.0.0.1:15412" },
            ],
          },
        },
        networkConnectSources: {
          all: ["https://gateway.example", "http://localhost:15411"],
          signer: ["http://localhost:15411", "http://127.0.0.1:15412"],
        },
      });
    });

    it.each([
      ["PUBKY_TESTNET_PKARR_RELAYS", "PUBKY_TESTNET_PKARR_RELAYS is required."],
      ["PUBKY_TESTNET_HTTP_RELAY", "PUBKY_TESTNET_HTTP_RELAY is required."],
    ] as const)("a testnet requires %s", (name, message) => {
      stubPassportEnvironment({ ...TESTNET, [name]: undefined });
      expect(() => getPublicEnvironment()).toThrow(message);
    });

    it.each([
      "PUBKY_TESTNET_PKARR_RELAYS",
      "PUBKY_TESTNET_HTTP_RELAY",
      "PUBKY_TESTNET_URL_REWRITES_JSON",
    ])("fails startup when mainnet is given %s instead of ignoring it", (name) => {
      stubPassportEnvironment({ [name]: "https://gateway.example/x" });
      expect(() => getPublicEnvironment()).toThrow(`${name} requires PUBKY_NETWORK=testnet.`);
    });

    it("refuses an unknown network and a mainnet relay setting on a testnet", () => {
      stubPassportEnvironment({ PUBKY_NETWORK: "devnet" });
      expect(() => getPublicEnvironment()).toThrow('PUBKY_NETWORK must be "mainnet" or "testnet".');
      stubPassportEnvironment({ ...TESTNET, PUBKY_HTTP_RELAY_URL: "https://relay.example/inbox" });
      expect(() => getPublicEnvironment()).toThrow(
        "Use PUBKY_TESTNET_HTTP_RELAY instead of PUBKY_HTTP_RELAY_URL on a testnet.",
      );
    });

    it.each([
      "http://gateway.example/_pubky/pkarr",
      "http://10.0.0.2:15411",
      "https://user:secret@gateway.example/pkarr",
      "https://gateway.example/pkarr?token=CANARY",
      "https://gateway.example/pkarr#CANARY",
      "https://192.0.2.1/pkarr",
      "gateway.example/pkarr",
    ])("refuses the testnet URL %s without echoing it", (url) => {
      for (const name of ["PUBKY_TESTNET_PKARR_RELAYS", "PUBKY_TESTNET_HTTP_RELAY"] as const) {
        stubPassportEnvironment({ ...TESTNET, [name]: url });
        const error = captureError(() => getPublicEnvironment());
        expect(error.message).toBe(`${name} must use HTTPS URLs (HTTP only on localhost).`);
        expect(error.message).not.toContain("CANARY");
      }
    });

    it("takes at most eight PKARR relays", () => {
      stubPassportEnvironment({
        ...TESTNET,
        PUBKY_TESTNET_PKARR_RELAYS: Array.from(
          { length: 9 },
          (_, i) => `https://r${i}.example`,
        ).join(","),
      });
      expect(() => getPublicEnvironment()).toThrow("at most 8 URLs");
    });

    it.each([
      ["{CANARY", "PUBKY_TESTNET_URL_REWRITES_JSON must be valid JSON."],
      [
        '["http://localhost:6286"]',
        "PUBKY_TESTNET_URL_REWRITES_JSON must be an object of URL prefixes.",
      ],
      ['{"http://localhost:6286": 1}', "PUBKY_TESTNET_URL_REWRITES_JSON must map URLs to URLs."],
      [
        '{"ftp://localhost:6286": "https://gateway.example"}',
        "PUBKY_TESTNET_URL_REWRITES_JSON must map HTTP(S) URL prefixes without credentials, query or fragment.",
      ],
      [
        '{"http://localhost:6286?CANARY": "https://gateway.example"}',
        "PUBKY_TESTNET_URL_REWRITES_JSON must map HTTP(S) URL prefixes without credentials, query or fragment.",
      ],
      [
        '{"http://localhost:6286": "http://gateway.example/hs"}',
        "PUBKY_TESTNET_URL_REWRITES_JSON must use HTTPS URLs (HTTP only on localhost).",
      ],
      [
        '{"http://localhost:6286": "https://a.example", "http://localhost:6286/": "https://b.example"}',
        "PUBKY_TESTNET_URL_REWRITES_JSON repeats a URL prefix.",
      ],
    ])("refuses the rewrites %s without echoing them", (configuration, message) => {
      stubPassportEnvironment({ ...TESTNET, PUBKY_TESTNET_URL_REWRITES_JSON: configuration });
      const error = captureError(() => getPublicEnvironment());
      expect(error.message).toBe(message);
      expect(error).not.toHaveProperty("cause");
      expect(error.message).not.toContain("CANARY");
    });
  });

  it("does not expose the JSON parser error for a malformed keyring", () => {
    const secretFragment = "server-secret-material";
    vi.stubEnv("PASSPORT_SERVER_SECRET_KEYRING_JSON", `not-json-${secretFragment}`);
    try {
      getServerEnvironment();
      throw new Error("Expected malformed keyring failure.");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toBe("PASSPORT_SERVER_SECRET_KEYRING_JSON must be valid JSON.");
      expect(e).not.toHaveProperty("cause");
      expect(String(e)).not.toContain(secretFragment);
    }
  });

  it.each(["null", "[]"])("rejects an invalid keyring: %s", (keyring) => {
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

function captureError(action: () => unknown): Error {
  try {
    action();
  } catch (e) {
    if (e instanceof Error) return e;
    throw new Error("Expected an Error instance.", { cause: e });
  }
  throw new Error("Expected the action to throw.");
}
