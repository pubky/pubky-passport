import "client-only";

import { Keypair } from "@synonymdev/pubky";

import {
  pubkySecretKeyBytes,
  pubkySecretKeyFormat,
  type PubkyPublicIdentity,
} from "../../../core/domain/identity/pubkyIdentity";

const sdkKeypairs = new WeakMap<PubkyIdentityKeypair, Keypair>();

export type PubkySecretKey = {
  bytes: Uint8Array;
  format: typeof pubkySecretKeyFormat;
};

export type PubkyIdentityKeyErrorCode =
  | "invalid_secret_key"
  | "key_unavailable"
  | "keypair_creation_failed"
  | "secret_export_failed"
  | "secret_restore_failed";

export type PubkyIdentityKeyError = {
  code: PubkyIdentityKeyErrorCode;
  message: string;
};

export type PubkyIdentityKeyResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PubkyIdentityKeyError };

export type PubkyRestoreKeypairInput = {
  secretKeyBytes: Uint8Array;
};

export class PubkyIdentityKeypair {
  private constructor(keypair: Keypair) {
    sdkKeypairs.set(this, keypair);
  }

  static create(): PubkyIdentityKeyResult<PubkyIdentityKeypair> {
    try {
      return { ok: true, value: new PubkyIdentityKeypair(Keypair.random()) };
    } catch {
      return failure("keypair_creation_failed", "Pubky identity keypair creation failed.");
    }
  }

  static restoreFromSecretKey(input: PubkyRestoreKeypairInput): PubkyIdentityKeyResult<PubkyIdentityKeypair> {
    try {
      const validationError = validateSecretKeyInput(input);

      if (validationError) {
        return { ok: false, error: validationError };
      }

      return {
        ok: true,
        value: new PubkyIdentityKeypair(Keypair.fromSecret(input.secretKeyBytes)),
      };
    } catch {
      return failure("secret_restore_failed", "Pubky identity secret key restoration failed.");
    } finally {
      // `fromSecret` has consumed the bytes; no caller-owned plaintext remains after restoration fails or succeeds.
      input.secretKeyBytes.fill(0);
    }
  }

  publicIdentity(): PubkyPublicIdentity {
    const publicKey = sdkKeypairFor(this).publicKey;

    try {
      return {
        publicKeyZ32: publicKey.z32(),
        publicKeyDisplay: publicKey.toString(),
      };
    } finally {
      publicKey.free();
    }
  }

  exportSecretKey(): PubkyIdentityKeyResult<PubkySecretKey> {
    try {
      return {
        ok: true,
        value: {
          bytes: sdkKeypairFor(this).secret(),
          format: pubkySecretKeyFormat,
        },
      };
    } catch {
      return failure("secret_export_failed", "Pubky identity secret key export failed.");
    }
  }

  dispose(): void {
    const keypair = sdkKeypairs.get(this);

    if (!keypair) {
      return;
    }

    keypair.free();
    sdkKeypairs.delete(this);
  }
}

export function withPubkySdkKeypair<T>(
  keypair: PubkyIdentityKeypair,
  handleKeypair: (keypair: Keypair) => T,
): PubkyIdentityKeyResult<T> {
  const sdkKeypair = sdkKeypairs.get(keypair);

  if (!sdkKeypair) {
    return failure("key_unavailable", "Pubky identity keypair is not available.");
  }

  return { ok: true, value: handleKeypair(sdkKeypair) };
}

export class PubkyIdentityKeyAdapter {
  createKeypair(): PubkyIdentityKeyResult<PubkyIdentityKeypair> {
    return PubkyIdentityKeypair.create();
  }

  restoreKeypair(input: PubkyRestoreKeypairInput): PubkyIdentityKeyResult<PubkyIdentityKeypair> {
    return PubkyIdentityKeypair.restoreFromSecretKey(input);
  }

  getPublicIdentity(keypair: PubkyIdentityKeypair): PubkyPublicIdentity {
    return keypair.publicIdentity();
  }

  exportSecretKey(keypair: PubkyIdentityKeypair): PubkyIdentityKeyResult<PubkySecretKey> {
    return keypair.exportSecretKey();
  }
}

function validateSecretKeyInput(input: PubkyRestoreKeypairInput): PubkyIdentityKeyError | undefined {
  if (!(input.secretKeyBytes instanceof Uint8Array) || input.secretKeyBytes.byteLength !== pubkySecretKeyBytes) {
    return {
      code: "invalid_secret_key",
      message: "Pubky identity secret key bytes are missing or invalid.",
    };
  }

  return undefined;
}

function sdkKeypairFor(keypair: PubkyIdentityKeypair): Keypair {
  const sdkKeypair = sdkKeypairs.get(keypair);

  if (!sdkKeypair) {
    throw new Error("Pubky identity keypair is not available.");
  }

  return sdkKeypair;
}

function failure<T>(code: PubkyIdentityKeyErrorCode, message: string): PubkyIdentityKeyResult<T> {
  return { ok: false, error: { code, message } };
}
