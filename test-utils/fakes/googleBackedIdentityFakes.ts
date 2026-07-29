import { Result } from "better-result";

import type {
  HomegateInvitationErrorCode,
  GoogleSignupInvitationRequester,
} from "@/browser/homegate/application/homegateInvitation";
import type { LocalIdentitySaver } from "@/browser/identity/local-identity/application/saveLocalIdentity";
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

export const fakePassportEnvelope: PassportFileEnvelopeV1 = {
  v: 1,
  iv: "a".repeat(16),
  ct: "b".repeat(64),
  url: "https://passport.pubky.app",
};

export const fakePassportReference: PassportFileReference = {
  storageId: "opaque-file-id",
  revision: "42",
};

export const fakeGoogleIdentitySession = {
  googleIdToken: "id-token",
  driveAccessToken: "drive-token",
};

export const fakeSignupInvitation = {
  signupCode: "homegate-signup-code",
  homeserverPubky: "homegate-homeserver",
};

export class FakePassportFileStore implements PassportFileStore {
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
    return this.createFailure ? Result.err({ code: this.createFailure }) : Result.ok(fakePassportReference);
  }

  async deletePassportFile(input: { reference: PassportFileReference }) {
    this.deleteCalls += 1;
    this.deletedExpectedReferences.push(
      input.reference.storageId === fakePassportReference.storageId
      && input.reference.revision === fakePassportReference.revision,
    );
    return this.deleteFailure ? Result.err({ code: this.deleteFailure }) : Result.ok();
  }
}

export class FakePassportCrypto implements PassportFileCrypto {
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
    return Result.ok(fakePassportEnvelope);
  }

  encryptedInputIsZeroed(): boolean {
    return this.#encryptedBytes !== null && this.#encryptedBytes.every((byte) => byte === 0);
  }

  decryptedOutputIsZeroed(): boolean {
    return this.#decryptedBytes.every((byte) => byte === 0);
  }
}

export class FakeLocalIdentitySaver implements LocalIdentitySaver {
  readonly #onSave: (() => void) | undefined;
  saveCalls = 0;
  throwOnSave = false;

  constructor(onSave?: () => void) {
    this.#onSave = onSave;
  }

  async saveIdentity() {
    if (this.throwOnSave) throw new Error("local save threw");
    this.#onSave?.();
    this.saveCalls += 1;
    return Result.ok({
      id: "fake",
      publicIdentity: { publicKeyZ32: "fake", publicKeyDisplay: "pubkyfake" },
    });
  }
}

export class FakeGoogleSignupInvitationRequester implements GoogleSignupInvitationRequester {
  readonly #onRequest: (() => void) | undefined;
  calls: Array<{ hasGoogleIdToken: boolean }> = [];
  failure?: HomegateInvitationErrorCode;

  constructor(onRequest?: () => void) {
    this.#onRequest = onRequest;
  }

  async requestGoogleSignupInvitation(input: { googleIdToken: string }) {
    this.#onRequest?.();
    this.calls.push({ hasGoogleIdToken: input.googleIdToken.trim().length > 0 });
    if (this.failure) return Result.err({ code: this.failure });
    return Result.ok(fakeSignupInvitation);
  }
}
