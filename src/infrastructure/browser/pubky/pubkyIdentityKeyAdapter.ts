import { Keypair } from "@synonymdev/pubky";

import type { PubkyPublicIdentity } from "../../../core/domain/identity/pubkyIdentity";

const sdkKeypairs = new WeakMap<PubkyIdentityKeypair, Keypair>();

export type PubkyRecoveryFile = {
  bytes: Uint8Array;
  format: "pubky-recovery-file";
  sdkPackage: "@synonymdev/pubky";
  sdkVersion: "0.9.3";
};

export type PubkyIdentityKeyErrorCode =
  | "invalid_passphrase"
  | "invalid_recovery_file"
  | "key_unavailable"
  | "keypair_creation_failed"
  | "recovery_export_failed"
  | "recovery_restore_failed";

export type PubkyIdentityKeyError = {
  code: PubkyIdentityKeyErrorCode;
  message: string;
};

export type PubkyIdentityKeyResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PubkyIdentityKeyError };

export type PubkyRecoveryFileInput = {
  passphrase: string;
};

export type PubkyRestoreKeypairInput = {
  recoveryFileBytes: Uint8Array;
  passphrase: string;
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

  static restoreFromRecoveryFile(input: PubkyRestoreKeypairInput): PubkyIdentityKeyResult<PubkyIdentityKeypair> {
    const validationError = validateRecoveryFileInput(input);

    if (validationError) {
      return { ok: false, error: validationError };
    }

    try {
      return {
        ok: true,
        value: new PubkyIdentityKeypair(Keypair.fromRecoveryFile(input.recoveryFileBytes, input.passphrase)),
      };
    } catch {
      return failure("recovery_restore_failed", "Pubky identity recovery file restoration failed.");
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

  exportRecoveryFile(input: PubkyRecoveryFileInput): PubkyIdentityKeyResult<PubkyRecoveryFile> {
    const passphraseError = validatePassphrase(input.passphrase);

    if (passphraseError) {
      return { ok: false, error: passphraseError };
    }

    try {
      return {
        ok: true,
        value: {
          bytes: sdkKeypairFor(this).createRecoveryFile(input.passphrase),
          format: "pubky-recovery-file",
          sdkPackage: "@synonymdev/pubky",
          sdkVersion: "0.9.3",
        },
      };
    } catch {
      return failure("recovery_export_failed", "Pubky identity recovery file export failed.");
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
    return PubkyIdentityKeypair.restoreFromRecoveryFile(input);
  }

  getPublicIdentity(keypair: PubkyIdentityKeypair): PubkyPublicIdentity {
    return keypair.publicIdentity();
  }

  exportRecoveryFile(
    keypair: PubkyIdentityKeypair,
    input: PubkyRecoveryFileInput,
  ): PubkyIdentityKeyResult<PubkyRecoveryFile> {
    return keypair.exportRecoveryFile(input);
  }
}

function validateRecoveryFileInput(input: PubkyRestoreKeypairInput): PubkyIdentityKeyError | undefined {
  const passphraseError = validatePassphrase(input.passphrase);

  if (passphraseError) {
    return passphraseError;
  }

  if (!(input.recoveryFileBytes instanceof Uint8Array) || input.recoveryFileBytes.byteLength === 0) {
    return {
      code: "invalid_recovery_file",
      message: "Pubky identity recovery file bytes are missing or invalid.",
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

function validatePassphrase(passphrase: string): PubkyIdentityKeyError | undefined {
  if (passphrase.length === 0) {
    return {
      code: "invalid_passphrase",
      message: "Pubky identity recovery passphrase is missing.",
    };
  }

  return undefined;
}

function failure<T>(code: PubkyIdentityKeyErrorCode, message: string): PubkyIdentityKeyResult<T> {
  return { ok: false, error: { code, message } };
}
