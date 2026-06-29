import { describe, expect, it } from "vitest";

import { PubkyIdentityKeyAdapter } from "./pubkyIdentityKeyAdapter";

const recoveryPassphrase = "test-domain-separated-passphrase";

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

  it("exports and restores SDK recovery file bytes", () => {
    const adapter = new PubkyIdentityKeyAdapter();
    const createdKeypair = expectOk(adapter.createKeypair());

    try {
      const originalPublicIdentity = adapter.getPublicIdentity(createdKeypair);
      const recoveryFile = expectOk(adapter.exportRecoveryFile(createdKeypair, { passphrase: recoveryPassphrase }));

      expect(recoveryFile.format).toBe("pubky-recovery-file");
      expect(recoveryFile.sdkPackage).toBe("@synonymdev/pubky");
      expect(recoveryFile.sdkVersion).toBe("0.9.3");
      expect(recoveryFile.bytes).toBeInstanceOf(Uint8Array);
      expect(recoveryFile.bytes.byteLength).toBeGreaterThan(0);

      const restoredKeypair = expectOk(
        adapter.restoreKeypair({ recoveryFileBytes: recoveryFile.bytes, passphrase: recoveryPassphrase }),
      );

      try {
        expect(adapter.getPublicIdentity(restoredKeypair)).toEqual(originalPublicIdentity);
      } finally {
        restoredKeypair.dispose();
      }
    } finally {
      createdKeypair.dispose();
    }
  });

  it("rejects missing recovery passphrases without calling the SDK", () => {
    const adapter = new PubkyIdentityKeyAdapter();
    const createdKeypair = expectOk(adapter.createKeypair());

    try {
      const exported = adapter.exportRecoveryFile(createdKeypair, { passphrase: "" });
      const restored = adapter.restoreKeypair({ recoveryFileBytes: new Uint8Array([1]), passphrase: "" });

      expect(exported).toEqual({
        ok: false,
        error: {
          code: "invalid_passphrase",
          message: "Pubky identity recovery passphrase is missing.",
        },
      });
      expect(restored).toEqual(exported);
    } finally {
      createdKeypair.dispose();
    }
  });

  it("rejects empty recovery file bytes before SDK restoration", () => {
    const adapter = new PubkyIdentityKeyAdapter();
    const restored = adapter.restoreKeypair({ recoveryFileBytes: new Uint8Array(), passphrase: recoveryPassphrase });

    expect(restored).toEqual({
      ok: false,
      error: {
        code: "invalid_recovery_file",
        message: "Pubky identity recovery file bytes are missing or invalid.",
      },
    });
  });

  it("maps wrong recovery passphrases to safe restore errors", () => {
    const adapter = new PubkyIdentityKeyAdapter();
    const createdKeypair = expectOk(adapter.createKeypair());

    try {
      const recoveryFile = expectOk(adapter.exportRecoveryFile(createdKeypair, { passphrase: recoveryPassphrase }));
      const restored = adapter.restoreKeypair({
        recoveryFileBytes: recoveryFile.bytes,
        passphrase: "wrong-passphrase",
      });

      expect(restored).toEqual({
        ok: false,
        error: {
          code: "recovery_restore_failed",
          message: "Pubky identity recovery file restoration failed.",
        },
      });
    } finally {
      createdKeypair.dispose();
    }
  });
});

function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  expect(result.ok).toBe(true);
  return (result as { ok: true; value: T }).value;
}
