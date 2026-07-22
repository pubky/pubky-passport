import { describe, expect, it } from "vitest";
import { Result, type Result as ResultType } from "better-result";

import { pubkySecretKeyBytes, pubkySecretKeyFormat, type PubkyIdentityKeyHandle } from "../../features/identity/pubkyIdentity";
import type { ValidatedSensitivePubkyAuthRequest } from "../../features/auth/parsePubkyAuthRequest";
import { BrowserPubky, pubkyNetworkForTestnetHost } from "./browserPubky";

const testNetwork = { kind: "testnet" as const, host: "localhost" };

describe("BrowserPubky", () => {
  it("selects testnet only when an explicit host is configured", () => {
    expect(pubkyNetworkForTestnetHost(undefined)).toEqual({ kind: "mainnet" });
    expect(pubkyNetworkForTestnetHost("localhost")).toEqual(testNetwork);
  });

  it("constructs mainnet and testnet SDK facades", () => {
    const mainnet = new BrowserPubky();
    const testnet = new BrowserPubky({ network: testNetwork });

    mainnet.dispose();
    testnet.dispose();
  });

  it("creates an opaque key handle and derives public identity", async () => {
    const pubky = new BrowserPubky({ network: testNetwork });

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const identity = expectOk(await pubky.getPublicIdentity({ keyHandle: created.keyHandle }));

      expect(identity).toEqual(created.publicIdentity);
      expect(identity.publicKeyZ32).toMatch(/^[13456789abcdefghijkmnopqrstuwxyz]+$/);
      expect(identity.publicKeyDisplay).toBe(`pubky${identity.publicKeyZ32}`);
    } finally {
      pubky.dispose();
    }
  });

  it("exports and restores 32-byte key material without retaining plaintext input", async () => {
    const pubky = new BrowserPubky({ network: testNetwork });

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const exported = expectOk(await pubky.exportSecretKey({ keyHandle: created.keyHandle }));

      expect(exported.format).toBe(pubkySecretKeyFormat);
      expect(exported.bytes).toHaveLength(pubkySecretKeyBytes);

      const restored = expectOk(await pubky.restoreIdentityKey({ secretKey: exported }));

      expect(exported.bytes).toEqual(new Uint8Array(pubkySecretKeyBytes));
      expect(restored.publicIdentity).toEqual(created.publicIdentity);
    } finally {
      pubky.dispose();
    }
  });

  it("rejects and clears invalid key material before restoration", async () => {
    const pubky = new BrowserPubky({ network: testNetwork });
    const bytes = new Uint8Array(pubkySecretKeyBytes - 1).fill(7);

    try {
      await expectError(
        pubky.restoreIdentityKey({ secretKey: { bytes, format: pubkySecretKeyFormat } }),
        "invalid_secret_key",
      );
      expect(bytes).toEqual(new Uint8Array(pubkySecretKeyBytes - 1));
    } finally {
      pubky.dispose();
    }
  });

  it("returns safe unavailable errors for unknown key handles", async () => {
    const pubky = new BrowserPubky({ network: testNetwork });
    const keyHandle = {} as PubkyIdentityKeyHandle;

    try {
      await expectError(pubky.getPublicIdentity({ keyHandle }), "key_unavailable");
      await expectError(pubky.exportSecretKey({ keyHandle }), "key_unavailable");
      await expectError(pubky.signup({ keyHandle, homeserverPubky: "not used" }), "key_unavailable");
      await expectError(pubky.publishHomeserverIfStale({ keyHandle }), "key_unavailable");
    } finally {
      pubky.dispose();
    }
  });

  it("maps invalid homeserver values without exposing signup codes", async () => {
    const pubky = new BrowserPubky({ network: testNetwork });

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const signup = await pubky.signup({
        keyHandle: created.keyHandle,
        homeserverPubky: "not a public key",
        signupCode: "sensitive-signup-code",
      });
      const discovery = await pubky.publishHomeserverForce({
        keyHandle: created.keyHandle,
        homeserverPubky: "not a public key",
      });

      expectErrorResult(signup, "invalid_homeserver_pubky");
      expectErrorResult(discovery, "invalid_homeserver_pubky");
      expect(JSON.stringify(signup)).not.toContain("sensitive-signup-code");
    } finally {
      pubky.dispose();
    }
  });

  it("rejects auth requests not issued by the parser before SDK approval", async () => {
    const pubky = new BrowserPubky({ network: testNetwork });

    try {
      const result = await pubky.approveAuthRequest({
        keyHandle: {} as PubkyIdentityKeyHandle,
        authRequest: {
          sensitivePubkyAuthUrl:
            "pubkyauth://signin?secret=should-not-be-returned&relay=https://httprelay.pubky.app/inbox&caps=/pub/pubky.app/:rw" as ValidatedSensitivePubkyAuthRequest["sensitivePubkyAuthUrl"],
        },
      });

      expectErrorResult(result, "request_rejected");
      expect(JSON.stringify(result)).not.toContain("should-not-be-returned");
    } finally {
      pubky.dispose();
    }
  });

  it("disposes keypairs and rejects old handles", async () => {
    const pubky = new BrowserPubky({ network: testNetwork });
    const created = expectOk(await pubky.createIdentityKey());

    pubky.dispose();
    pubky.dispose();

    await expectError(pubky.getPublicIdentity({ keyHandle: created.keyHandle }), "key_unavailable");
    await expectError(pubky.createIdentityKey(), "key_unavailable");
  });
});

async function expectError<T>(result: Promise<ResultType<T, { code: string }>>, code: string): Promise<void> {
  expectErrorResult(await result, code);
}

function expectErrorResult(result: ResultType<unknown, { code: string }>, code: string): void {
  expect(Result.isError(result)).toBe(true);
  if (Result.isError(result)) {
    expect(result.error).toEqual({ code });
  }
}

function expectOk<T>(result: ResultType<T, unknown>): T {
  expect(Result.isOk(result)).toBe(true);
  if (Result.isError(result)) {
    throw result.error;
  }

  return result.value;
}
