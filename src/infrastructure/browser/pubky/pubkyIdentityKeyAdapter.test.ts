import { describe, expect, it } from "vitest";
import { Result, type Result as ResultType } from "better-result";

import { pubkySecretKeyBytes, pubkySecretKeyFormat } from "../../../core/domain/identity/pubkyIdentity";
import { expectResultError } from "../../../../test-utils/resultAssertions";
import { PubkyIdentityKeyAdapter, withPubkySdkKeypair } from "./pubkyIdentityKeyAdapter";

describe("PubkyIdentityKeyAdapter", () => {
  it("creates a keypair and derives public identity display values", () => {
    const adapter = new PubkyIdentityKeyAdapter();
    const created = adapter.createKeypair();
    const keypair = expectOk(created);

    try {
      const publicIdentity = expectOk(adapter.getPublicIdentity(keypair));

      expect(publicIdentity.publicKeyZ32).toMatch(/^[13456789abcdefghijkmnopqrstuwxyz]+$/);
      expect(publicIdentity.publicKeyZ32.length).toBeGreaterThan(40);
      expect(publicIdentity.publicKeyDisplay).toBe(`pubky${publicIdentity.publicKeyZ32}`);
    } finally {
      keypair.dispose();
    }
  });

  it.each([
    ["accessing the SDK public key", () => {
      throw new Error("public key unavailable");
    }],
    ["encoding the public key", () => ({
      z32: () => {
        throw new Error("z32 encoding failed");
      },
      toString: () => "pubkytest",
      free: (): void => undefined,
    })],
    ["formatting the public key", () => ({
      z32: () => "test",
      toString: () => {
        throw new Error("display formatting failed");
      },
      free: (): void => undefined,
    })],
  ])("maps SDK failures while %s", (_scenario, publicKey) => {
    const adapter = new PubkyIdentityKeyAdapter();
    const keypair = expectOk(adapter.createKeypair());
    const sdkKeypair = expectOk(withPubkySdkKeypair(keypair, (value) => value));

    try {
      Object.defineProperty(sdkKeypair, "publicKey", {
        configurable: true,
        get: publicKey,
      });

      expectResultError(adapter.getPublicIdentity(keypair), {
        code: "public_identity_failed",
        message: "Pubky public identity derivation failed.",
      });
    } finally {
      keypair.dispose();
    }
  });

  it("exports and restores 32-byte SDK secret key bytes", () => {
    const adapter = new PubkyIdentityKeyAdapter();
    const createdKeypair = expectOk(adapter.createKeypair());

    try {
      const originalPublicIdentity = expectOk(adapter.getPublicIdentity(createdKeypair));
      const secretKey = expectOk(adapter.exportSecretKey(createdKeypair));

      expect(secretKey.format).toBe(pubkySecretKeyFormat);
      expect(secretKey.bytes).toBeInstanceOf(Uint8Array);
      expect(secretKey.bytes.byteLength).toBe(pubkySecretKeyBytes);

      const restoredKeypair = expectOk(adapter.restoreKeypair({ secretKeyBytes: secretKey.bytes }));

      try {
        expect(secretKey.bytes).toEqual(new Uint8Array(pubkySecretKeyBytes));
        expect(expectOk(adapter.getPublicIdentity(restoredKeypair))).toEqual(originalPublicIdentity);
      } finally {
        restoredKeypair.dispose();
      }
    } finally {
      createdKeypair.dispose();
    }
  });

  it("rejects invalid secret key bytes before SDK restoration", () => {
    const adapter = new PubkyIdentityKeyAdapter();
    const secretKeyBytes = new Uint8Array(pubkySecretKeyBytes - 1).fill(7);
    const restored = adapter.restoreKeypair({ secretKeyBytes });

    expect(Result.isError(restored)).toBe(true);
    if (Result.isError(restored)) {
      expect(restored.error).toEqual({
        code: "invalid_secret_key",
        message: "Pubky identity secret key bytes are missing or invalid.",
      },
      );
    }
    expect(secretKeyBytes).toEqual(new Uint8Array(pubkySecretKeyBytes - 1));
  });

  it("maps disposed keypairs to key unavailable", () => {
    const adapter = new PubkyIdentityKeyAdapter();
    const keypair = expectOk(adapter.createKeypair());

    keypair.dispose();

    const result = withPubkySdkKeypair(keypair, (sdkKeypair) => sdkKeypair);
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({
        code: "key_unavailable",
        message: "Pubky identity keypair is not available.",
      },
      );
    }
  });
});

function expectOk<T>(result: ResultType<T, unknown>): T {
  expect(Result.isOk(result)).toBe(true);
  if (Result.isError(result)) {
    throw result.error;
  }

  return result.value;
}
