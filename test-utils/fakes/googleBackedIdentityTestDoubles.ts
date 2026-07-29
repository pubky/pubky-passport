import { Result } from "better-result";

import { SaveLocalIdentity } from "../../src/browser/identity/local-identity/application/saveLocalIdentity";
import type { LocalIdentityKeyStore } from "../../src/browser/identity/local-identity/application/localIdentityRepository";
import type { PubkyIdentityKeys } from "../../src/browser/pubky/application/pubkyIdentityKeys";
import type {
  PassportFileCrypto,
  PassportFileCryptoResult,
} from "@/browser/passport-file/application/passportFileCrypto";
import type {
  PassportFileReadResult,
  PassportFileReference,
  PassportFileStore,
  PassportFileStoreErrorCode,
} from "@/browser/passport-file/application/passportFileStore";
import type { PassportFileEnvelopeV1 } from "@/core/passport-file/passportFile";

export const TEST_PASSPORT_ENVELOPE: PassportFileEnvelopeV1 = {
  v: 1,
  iv: "a".repeat(16),
  ct: "b".repeat(64),
  url: "https://passport.pubky.app",
};

export const TEST_PASSPORT_REFERENCE: PassportFileReference = {
  storageId: "opaque-file-id",
  revision: "42",
};

export const TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS = {
  googleIdToken: "id-token",
  driveAccessToken: "drive-token",
};

export const TEST_SIGNUP_INVITATION = {
  signupCode: "homegate-signup-code",
  homeserverPubky: "homegate-homeserver",
};

export class SanitizedPassportFileStore implements PassportFileStore {
  readonly #readResult: PassportFileReadResult | { code: PassportFileStoreErrorCode };
  readonly #onCreate: (() => void) | undefined;
  createdFiles: Array<{
    version: number;
    url: string;
    ivCharacters: number;
    ciphertextCharacters: number;
  }> = [];
  deleteCalls = 0;
  deletedExpectedReferences: boolean[] = [];
  createFailure?: PassportFileStoreErrorCode;
  deleteFailure?: PassportFileStoreErrorCode;

  constructor(
    readResult: PassportFileReadResult | { code: PassportFileStoreErrorCode },
    onCreate?: () => void,
  ) {
    this.#readResult = readResult;
    this.#onCreate = onCreate;
  }

  async readPassportFile() {
    return "code" in this.#readResult ? Result.err(this.#readResult) : Result.ok(this.#readResult);
  }

  async createPassportFile(input: { envelope: PassportFileEnvelopeV1 }) {
    this.#onCreate?.();
    this.createdFiles.push({
      version: input.envelope.v,
      url: input.envelope.url,
      ivCharacters: input.envelope.iv.length,
      ciphertextCharacters: input.envelope.ct.length,
    });
    return this.createFailure ? Result.err({ code: this.createFailure }) : Result.ok(TEST_PASSPORT_REFERENCE);
  }

  async deletePassportFile(input: { reference: PassportFileReference }) {
    this.deleteCalls += 1;
    this.deletedExpectedReferences.push(
      input.reference.storageId === TEST_PASSPORT_REFERENCE.storageId
      && input.reference.revision === TEST_PASSPORT_REFERENCE.revision,
    );
    return this.deleteFailure ? Result.err({ code: this.deleteFailure }) : Result.ok();
  }
}

export class RecordingPassportFileCrypto implements PassportFileCrypto {
  readonly #decryptedBytes: Uint8Array<ArrayBuffer> = new Uint8Array(32).fill(7);
  #encryptedBytes: Uint8Array<ArrayBufferLike> | null = null;
  decryptCalls = 0;
  decryptFailure = false;
  encryptFailure = false;
  throwOnEncrypt = false;

  async decryptSecretKeyBytes(): Promise<PassportFileCryptoResult<Uint8Array>> {
    this.decryptCalls += 1;
    return this.decryptFailure
      ? Result.err({ code: "decrypt_failed" })
      : Result.ok(this.#decryptedBytes);
  }

  async encryptSecretKeyBytes(
    input: Parameters<PassportFileCrypto["encryptSecretKeyBytes"]>[0],
  ): Promise<PassportFileCryptoResult<PassportFileEnvelopeV1>> {
    this.#encryptedBytes = input.secretKeyBytes;
    if (this.throwOnEncrypt) throw new Error("encryption threw");
    if (this.encryptFailure) return Result.err({ code: "encrypt_failed" });
    return Result.ok(TEST_PASSPORT_ENVELOPE);
  }

  encryptedInputIsZeroed(): boolean {
    return this.#encryptedBytes !== null && this.#encryptedBytes.every((byte) => byte === 0);
  }

  decryptedOutputIsZeroed(): boolean {
    return this.#decryptedBytes.every((byte) => byte === 0);
  }
}

export class RecordingSaveLocalIdentity extends SaveLocalIdentity {
  readonly #onSave: (() => void) | undefined;
  saveCalls = 0;
  saveFailure = false;
  throwOnSave = false;

  constructor(onSave?: () => void) {
    super({ keyStore: new NoopLocalIdentityKeyStore(), identityKeys: new NoopPubkyIdentityKeys() });
    this.#onSave = onSave;
  }

  override async saveIdentity() {
    if (this.throwOnSave) throw new Error("local save threw");
    this.#onSave?.();
    this.saveCalls += 1;
    if (this.saveFailure) return Result.err({ code: "storage_unavailable" as const });
    return Result.ok({
      id: "fake",
      publicIdentity: { publicKeyZ32: "fake", publicKeyDisplay: "pubkyfake" },
    });
  }
}

class NoopLocalIdentityKeyStore implements LocalIdentityKeyStore {
  save(): ReturnType<LocalIdentityKeyStore["save"]> {
    return Result.err({ code: "storage_unavailable" });
  }

  readActive(): ReturnType<LocalIdentityKeyStore["readActive"]> {
    return Result.err({ code: "storage_unavailable" });
  }
}

class NoopPubkyIdentityKeys implements PubkyIdentityKeys {
  async createIdentityKey(): ReturnType<PubkyIdentityKeys["createIdentityKey"]> {
    return Result.err({ code: "key_unavailable" });
  }

  async restoreIdentityKey(): ReturnType<PubkyIdentityKeys["restoreIdentityKey"]> {
    return Result.err({ code: "key_unavailable" });
  }

  disposeIdentityKey(): void {}

  async exportSecretKey(): ReturnType<PubkyIdentityKeys["exportSecretKey"]> {
    return Result.err({ code: "key_unavailable" });
  }

  async getPublicIdentity(): ReturnType<PubkyIdentityKeys["getPublicIdentity"]> {
    return Result.err({ code: "key_unavailable" });
  }
}
