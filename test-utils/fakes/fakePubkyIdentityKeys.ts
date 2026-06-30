import type {
  PubkyIdentityKey,
  PubkyIdentityKeyHandle,
  PubkyPublicIdentity,
  PubkyRecoveryFileMaterial,
} from "@/core/domain/identity/pubkyIdentity";
import type {
  ExportPubkyRecoveryFileInput,
  GetPubkyPublicIdentityInput,
  PubkyIdentityKeys,
  PubkyIdentityKeysErrorCode,
  PubkyIdentityKeysResult,
  RestorePubkyIdentityKeyInput,
} from "@/core/ports/pubkyIdentityKeys";

export type FakePubkyIdentityKeysRestoreCall = {
  recoveryFileByteLength: number;
  recoveryFileFormat: string;
  hasRecoveryPassphrase: boolean;
};

export type FakePubkyIdentityKeysExportCall = {
  keyHandle: PubkyIdentityKeyHandle;
  hasRecoveryPassphrase: boolean;
};

export class FakePubkyIdentityKeys implements PubkyIdentityKeys {
  createCalls = 0;
  restoreCalls: FakePubkyIdentityKeysRestoreCall[] = [];
  exportCalls: FakePubkyIdentityKeysExportCall[] = [];
  publicIdentityCalls: GetPubkyPublicIdentityInput[] = [];

  createFailure?: PubkyIdentityKeysErrorCode;
  restoreFailure?: PubkyIdentityKeysErrorCode;
  exportFailure?: PubkyIdentityKeysErrorCode;
  publicIdentityFailure?: PubkyIdentityKeysErrorCode;

  nextPublicIdentity: PubkyPublicIdentity = {
    publicKeyZ32: "fakepubkyidentity1111111111111111111111111111111111111111111",
    publicKeyDisplay: "pubkyfakepubkyidentity1111111111111111111111111111111111111111111",
  };

  recoveryFile: PubkyRecoveryFileMaterial = {
    bytes: new Uint8Array([1, 2, 3]),
    format: "pubky-recovery-file",
    sdkVersion: "fake-sdk",
  };

  readonly #identities = new Map<PubkyIdentityKeyHandle, PubkyPublicIdentity>();

  async createIdentityKey(): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>> {
    this.createCalls += 1;

    if (this.createFailure) {
      return failure(this.createFailure);
    }

    return { ok: true, value: this.createKey(this.nextPublicIdentity) };
  }

  async restoreIdentityKey(input: RestorePubkyIdentityKeyInput): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>> {
    this.restoreCalls.push({
      recoveryFileByteLength: input.recoveryFile.bytes.byteLength,
      recoveryFileFormat: input.recoveryFile.format,
      hasRecoveryPassphrase: input.recoveryPassphrase.length > 0,
    });

    if (this.restoreFailure) {
      return failure(this.restoreFailure);
    }

    return { ok: true, value: this.createKey(this.nextPublicIdentity) };
  }

  async exportRecoveryFile(
    input: ExportPubkyRecoveryFileInput,
  ): Promise<PubkyIdentityKeysResult<PubkyRecoveryFileMaterial>> {
    this.exportCalls.push({
      keyHandle: input.keyHandle,
      hasRecoveryPassphrase: input.recoveryPassphrase.length > 0,
    });

    if (this.exportFailure) {
      return failure(this.exportFailure);
    }

    if (!this.#identities.has(input.keyHandle)) {
      return failure("key_unavailable");
    }

    return { ok: true, value: this.recoveryFile };
  }

  async getPublicIdentity(input: GetPubkyPublicIdentityInput): Promise<PubkyIdentityKeysResult<PubkyPublicIdentity>> {
    this.publicIdentityCalls.push(input);

    if (this.publicIdentityFailure) {
      return failure(this.publicIdentityFailure);
    }

    const publicIdentity = this.#identities.get(input.keyHandle);

    if (!publicIdentity) {
      return failure("key_unavailable");
    }

    return { ok: true, value: publicIdentity };
  }

  createKey(publicIdentity: PubkyPublicIdentity = this.nextPublicIdentity): PubkyIdentityKey {
    const keyHandle = {} as PubkyIdentityKeyHandle;
    this.#identities.set(keyHandle, publicIdentity);

    return { keyHandle, publicIdentity };
  }
}

function failure<T>(code: PubkyIdentityKeysErrorCode): PubkyIdentityKeysResult<T> {
  return { ok: false, error: { code } };
}
