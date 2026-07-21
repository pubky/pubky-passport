import { describe, expect, it } from "vitest";
import { Result, type Result as ResultType } from "better-result";

import { PubkySdkIdentity } from "./pubkySdkIdentity";
import { PubkySdkKeypairAdapter, type PubkyIdentityKeypair } from "./pubkySdkKeypair";

describe("PubkySdkIdentity", () => {
  it("constructs mainnet and testnet SDK facades", () => {
    const mainnet = new PubkySdkIdentity();
    const testnet = new PubkySdkIdentity({ network: { kind: "testnet", host: "localhost" } });

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

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error).toEqual({
          code: "invalid_homeserver_pubky",
          message: "Homeserver public key is missing or invalid.",
          sdkErrorName: "InvalidInput",
        });
      }
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

      expect(Result.isError(ifStaleResult)).toBe(true);
      if (Result.isError(ifStaleResult)) {
        expect(ifStaleResult.error).toEqual({
          code: "invalid_homeserver_pubky",
          message: "Homeserver public key is missing or invalid.",
          sdkErrorName: "InvalidInput",
        });
      }
      expect(Result.isError(forceResult)).toBe(true);
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

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error).toEqual({
          code: "invalid_pubky_auth_request",
          message: "Pubky auth request URL is missing or invalid.",
        });
      }
      expect(JSON.stringify(result)).not.toContain("should-not-be-returned");
    } finally {
      keypair.dispose();
      identityAdapter.dispose();
    }
  });
});

function createAdapters(): { identityAdapter: PubkySdkIdentity; keypair: PubkyIdentityKeypair } {
  const identityAdapter = new PubkySdkIdentity({ network: { kind: "testnet", host: "localhost" } });
  const keyAdapter = new PubkySdkKeypairAdapter();
  const keypair = expectOk(keyAdapter.createKeypair());

  return { identityAdapter, keypair };
}

function expectOk<T>(result: ResultType<T, unknown>): T {
  expect(Result.isOk(result)).toBe(true);
  if (Result.isError(result)) {
    throw result.error;
  }

  return result.value;
}
