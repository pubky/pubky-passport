import { describe, expect, it } from "vitest";

import { pubkySecretKeyBytes, pubkySecretKeyFormat } from "../../../core/domain/identity/pubkyIdentity";
import { PubkyIdentityKeyAdapter, withPubkySdkKeypair } from "./pubkyIdentityKeyAdapter";

describe("PubkyIdentityKeyAdapter", () => {
  it("creates a keypair and derives public identity display values", () => {
    const adapter = new PubkyIdentityKeyAdapter();
    const created = adapter.createKeypair();
    const keypair = expectOk(created);

    try {
      const publicIdentity = adapter.getPublicIdentity(keypair);

      expect(publicIdentity.publicKeyZ32).toMatch(/^[13456789abcdefghijkmnopqrstuwxyz]+$/);
      expect(publicIdentity.publicKeyZ32.length).toBeGreaterThan(40);
      expect(publicIdentity.publicKeyDisplay).toBe(`pubky${publicIdentity.publicKeyZ32}`);
    } finally {
      keypair.dispose();
    }
  });

  it("exports and restores 32-byte SDK secret key bytes", () => {
    const adapter = new PubkyIdentityKeyAdapter();
    const createdKeypair = expectOk(adapter.createKeypair());

    try {
      const originalPublicIdentity = adapter.getPublicIdentity(createdKeypair);
      const secretKey = expectOk(adapter.exportSecretKey(createdKeypair));

      expect(secretKey.format).toBe(pubkySecretKeyFormat);
      expect(secretKey.bytes).toBeInstanceOf(Uint8Array);
      expect(secretKey.bytes.byteLength).toBe(pubkySecretKeyBytes);

      const restoredKeypair = expectOk(adapter.restoreKeypair({ secretKeyBytes: secretKey.bytes }));

      try {
        expect(adapter.getPublicIdentity(restoredKeypair)).toEqual(originalPublicIdentity);
      } finally {
        restoredKeypair.dispose();
      }
    } finally {
      createdKeypair.dispose();
    }
  });

  it("rejects invalid secret key bytes before SDK restoration", () => {
    const adapter = new PubkyIdentityKeyAdapter();
    const restored = adapter.restoreKeypair({ secretKeyBytes: new Uint8Array(pubkySecretKeyBytes - 1) });

    expect(restored).toEqual({
      ok: false,
      error: {
        code: "invalid_secret_key",
        message: "Pubky identity secret key bytes are missing or invalid.",
      },
    });
  });

  it("maps disposed keypairs to key unavailable", () => {
    const adapter = new PubkyIdentityKeyAdapter();
    const keypair = expectOk(adapter.createKeypair());

    keypair.dispose();

    expect(withPubkySdkKeypair(keypair, (sdkKeypair) => sdkKeypair)).toEqual({
      ok: false,
      error: {
        code: "key_unavailable",
        message: "Pubky identity keypair is not available.",
      },
    });
  });
});

function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  expect(result.ok).toBe(true);
  return (result as { ok: true; value: T }).value;
}
