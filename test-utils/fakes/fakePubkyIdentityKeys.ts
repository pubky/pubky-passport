import { Result } from "better-result";

import { pubkySecretKeyBytes, pubkySecretKeyFormat, type PubkySecretKeyMaterial } from "../../src/core/identity/pubkyIdentity";
import type {
  PubkyIdentityKey,
  PubkyIdentityKeyHandle,
  PubkyPublicIdentity,
} from "@/core/identity/pubkyIdentity";
import type {
  PubkyIdentityKeys,
  PubkyIdentityKeysErrorCode,
  PubkyIdentityKeysResult,
} from "@/core/identity/dependencies/pubky";

export type FakePubkyIdentityKeysRestoreCall = {
  secretKeyByteLength: number;
  secretKeyFormat: string;
};

export type FakePubkyIdentityKeysExportCall = {
  keyHandle: PubkyIdentityKeyHandle;
};

export class FakePubkyIdentityKeys implements PubkyIdentityKeys {
  createCalls = 0;
  restoreCalls: FakePubkyIdentityKeysRestoreCall[] = [];
  exportCalls: FakePubkyIdentityKeysExportCall[] = [];
  publicIdentityCalls: Array<{ keyHandle: PubkyIdentityKeyHandle }> = [];

  createFailure?: PubkyIdentityKeysErrorCode;
  restoreFailure?: PubkyIdentityKeysErrorCode;
  exportFailure?: PubkyIdentityKeysErrorCode;
  publicIdentityFailure?: PubkyIdentityKeysErrorCode;

  nextPublicIdentity: PubkyPublicIdentity = {
    publicKeyZ32: "fakepubkyidentity1111111111111111111111111111111111111111111",
    publicKeyDisplay: "pubkyfakepubkyidentity1111111111111111111111111111111111111111111",
  };

  secretKey: PubkySecretKeyMaterial = {
    bytes: new Uint8Array(Array.from({ length: pubkySecretKeyBytes }, (_, index) => index + 1)),
    format: pubkySecretKeyFormat,
  };

  readonly #identities = new Map<PubkyIdentityKeyHandle, PubkyPublicIdentity>();

  async createIdentityKey(): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>> {
    this.createCalls += 1;

    if (this.createFailure) {
      return failure(this.createFailure);
    }

    return Result.ok(this.createKey(this.nextPublicIdentity));
  }

  async restoreIdentityKey(input: { secretKey: PubkySecretKeyMaterial }): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>> {
    this.restoreCalls.push({
      secretKeyByteLength: input.secretKey.bytes.byteLength,
      secretKeyFormat: input.secretKey.format,
    });

    if (this.restoreFailure) {
      return failure(this.restoreFailure);
    }

    return Result.ok(this.createKey(this.nextPublicIdentity));
  }

  async exportSecretKey(
    input: { keyHandle: PubkyIdentityKeyHandle },
  ): Promise<PubkyIdentityKeysResult<PubkySecretKeyMaterial>> {
    this.exportCalls.push({
      keyHandle: input.keyHandle,
    });

    if (this.exportFailure) {
      return failure(this.exportFailure);
    }

    if (!this.#identities.has(input.keyHandle)) {
      return failure("key_unavailable");
    }

    return Result.ok(this.secretKey);
  }

  async getPublicIdentity(input: { keyHandle: PubkyIdentityKeyHandle }): Promise<PubkyIdentityKeysResult<PubkyPublicIdentity>> {
    this.publicIdentityCalls.push(input);

    if (this.publicIdentityFailure) {
      return failure(this.publicIdentityFailure);
    }

    const publicIdentity = this.#identities.get(input.keyHandle);

    if (!publicIdentity) {
      return failure("key_unavailable");
    }

    return Result.ok(publicIdentity);
  }

  createKey(publicIdentity: PubkyPublicIdentity = this.nextPublicIdentity): PubkyIdentityKey {
    const keyHandle = {} as PubkyIdentityKeyHandle;
    this.#identities.set(keyHandle, publicIdentity);

    return { keyHandle, publicIdentity };
  }
}

function failure<T>(code: PubkyIdentityKeysErrorCode): PubkyIdentityKeysResult<T> {
  return Result.err({ code });
}
