import { Result } from "better-result";

import { MemoryStorage } from "./memoryStorage";

import { SaveLocalIdentity } from "../../src/browser/identity/local/saveLocalIdentity";
import { LocalStorageIdentityRepository } from "../../src/browser/identity/local/localStorageIdentityRepository";
import { RecordingPubkySdkAdapter } from "./recordingPubkySdkAdapter";
import type {
  DecryptPassportSecretInput,
  EncryptPassportSecretInput,
  PassportFileCryptoResult,
} from "../../src/browser/passport-file/passportFileWebCrypto";
import type {
  PassportFileReadResult,
  PassportFileReference,
  PassportFileStoreErrorCode,
} from "../../src/browser/passport-file/googleDrivePassportFileStore";
import type { PassportFileEnvelopeV1 } from "../../src/browser/passport-file/passportFileEnvelope";

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
  googleAccount: {
    id: "google-account-id",
    email: "satoshi@gmail.com",
    name: "Satoshi Nakamoto",
    pictureUrl: null,
  },
};

export const TEST_SIGNUP_INVITATION = {
  signupCode: "homegate-signup-code",
  homeserverPubky: "homegate-homeserver",
};

export class RecordingPassportFileOperations {
  readonly #readResult: PassportFileReadResult | { code: PassportFileStoreErrorCode };
  readonly #onCreate: (() => void) | undefined;
  readonly #onVisibleCreate: (() => void) | undefined;
  createdFiles: Array<{
    version: number;
    url: string;
    ivCharacters: number;
    ciphertextCharacters: number;
  }> = [];
  deleteCalls = 0;
  deletedExpectedReferences: boolean[] = [];
  createFailure?: PassportFileStoreErrorCode;
  visibleRecoveryCopyFailure?: PassportFileStoreErrorCode;
  visibleRecoveryCopyPublicKeys: string[] = [];
  deleteFailure?: PassportFileStoreErrorCode;
  throwOnDelete = false;

  constructor(
    readResult: PassportFileReadResult | { code: PassportFileStoreErrorCode },
    onCreate?: () => void,
    onVisibleCreate?: () => void,
  ) {
    this.#readResult = readResult;
    this.#onCreate = onCreate;
    this.#onVisibleCreate = onVisibleCreate;
  }

  async readPassportFile(driveAccessToken: string) {
    void driveAccessToken;
    return "code" in this.#readResult ? Result.err(this.#readResult) : Result.ok(this.#readResult);
  }

  async createPassportFile(driveAccessToken: string, envelope: PassportFileEnvelopeV1) {
    void driveAccessToken;
    this.#onCreate?.();
    this.createdFiles.push({
      version: envelope.v,
      url: envelope.url,
      ivCharacters: envelope.iv.length,
      ciphertextCharacters: envelope.ct.length,
    });
    return this.createFailure
      ? Result.err({ code: this.createFailure })
      : Result.ok();
  }

  async createVisibleRecoveryCopy(
    driveAccessToken: string,
    envelope: PassportFileEnvelopeV1,
    publicKeyDisplay: string,
    signal?: AbortSignal,
  ) {
    void driveAccessToken;
    void envelope;
    void signal;
    this.visibleRecoveryCopyPublicKeys.push(publicKeyDisplay);
    this.#onVisibleCreate?.();
    return this.visibleRecoveryCopyFailure
      ? Result.err({ code: this.visibleRecoveryCopyFailure })
      : Result.ok();
  }

  async deletePassportFile(driveAccessToken: string, reference: PassportFileReference) {
    void driveAccessToken;
    if (this.throwOnDelete) throw new Error("Drive deletion threw");
    this.deleteCalls += 1;
    this.deletedExpectedReferences.push(
      reference.storageId === TEST_PASSPORT_REFERENCE.storageId
        && reference.revision === TEST_PASSPORT_REFERENCE.revision,
    );
    return this.deleteFailure ? Result.err({ code: this.deleteFailure }) : Result.ok();
  }
}

export class RecordingPassportFileCrypto {
  readonly #decryptedBytes: Uint8Array<ArrayBuffer> = new Uint8Array(32).fill(7);
  #encryptedBytes: Uint8Array<ArrayBufferLike> | null = null;
  decryptCalls = 0;
  decryptFailure = false;
  encryptFailure = false;
  throwOnEncrypt = false;

  async decryptSecretKeyBytes(input: DecryptPassportSecretInput): Promise<PassportFileCryptoResult<Uint8Array>> {
    void input;
    this.decryptCalls += 1;
    return this.decryptFailure
      ? Result.err({ code: "decrypt_failed" })
      : Result.ok(this.#decryptedBytes);
  }

  async encryptSecretKeyBytes(input: EncryptPassportSecretInput): Promise<PassportFileCryptoResult<PassportFileEnvelopeV1>> {
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
    const pubky = new RecordingPubkySdkAdapter();
    super(new LocalStorageIdentityRepository(new MemoryStorage()), pubky);
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
