import { describe, expect, it } from "vitest";

import { PubkyIdentityAdapter } from "./pubkyIdentityAdapter";
import { PubkyIdentityKeyAdapter, type PubkyIdentityKeypair } from "./pubkyIdentityKeyAdapter";

describe("PubkyIdentityAdapter", () => {
  it("constructs mainnet and testnet SDK facades", () => {
    const mainnet = new PubkyIdentityAdapter();
    const testnet = new PubkyIdentityAdapter({ network: { kind: "testnet", host: "localhost" } });

    mainnet.dispose();
    testnet.dispose();
  });

  it("maps invalid homeserver public keys without exposing signup codes", async () => {
    const { identityAdapter, keypair } = createAdapters();

    try {
      const result = await identityAdapter.signup({
        keypair,
        homeserverPubky: "not a public key",
        signupCode: "sensitive-signup-code",
      });

      expect(result).toEqual({
        ok: false,
        error: {
          code: "invalid_homeserver_pubky",
          message: "Homeserver public key is missing or invalid.",
          sdkErrorName: "InvalidInput",
        },
      });
      expect(JSON.stringify(result)).not.toContain("sensitive-signup-code");
    } finally {
      keypair.dispose();
      identityAdapter.dispose();
    }
  });

  it("maps invalid discovery homeserver overrides before network publication", async () => {
    const { identityAdapter, keypair } = createAdapters();

    try {
      const ifStaleResult = await identityAdapter.publishHomeserverIfStale({
        keypair,
        homeserverPubky: "not a public key",
      });
      const forceResult = await identityAdapter.publishHomeserverForce({
        keypair,
        homeserverPubky: "not a public key",
      });

      expect(ifStaleResult).toEqual({
        ok: false,
        error: {
          code: "invalid_homeserver_pubky",
          message: "Homeserver public key is missing or invalid.",
          sdkErrorName: "InvalidInput",
        },
      });
      expect(forceResult).toEqual(ifStaleResult);
    } finally {
      keypair.dispose();
      identityAdapter.dispose();
    }
  });

  it("maps invalid auth request URLs before SDK approval", async () => {
    const { identityAdapter, keypair } = createAdapters();

    try {
      const result = await identityAdapter.approveAuthRequest({
        keypair,
        sensitivePubkyAuthUrl: "https://example.com/callback?secret=should-not-be-returned",
      });

      expect(result).toEqual({
        ok: false,
        error: {
          code: "invalid_pubky_auth_request",
          message: "Pubky auth request URL is missing or invalid.",
        },
      });
      expect(JSON.stringify(result)).not.toContain("should-not-be-returned");
    } finally {
      keypair.dispose();
      identityAdapter.dispose();
    }
  });
});

function createAdapters(): { identityAdapter: PubkyIdentityAdapter; keypair: PubkyIdentityKeypair } {
  const identityAdapter = new PubkyIdentityAdapter({ network: { kind: "testnet", host: "localhost" } });
  const keyAdapter = new PubkyIdentityKeyAdapter();
  const keypair = expectOk(keyAdapter.createKeypair());

  return { identityAdapter, keypair };
}

function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  expect(result.ok).toBe(true);
  return (result as { ok: true; value: T }).value;
}
