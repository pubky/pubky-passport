import "client-only";

import type { Result } from "better-result";

import type { PassportFileEnvelopeV1 } from "../../core/passport-file/passportFile";

export type PassportFileReference = Readonly<{
  storageId: string;
  revision: string;
}>;

export type PassportFileReadResult =
  | { status: "found"; envelope: PassportFileEnvelopeV1; reference: PassportFileReference }
  | { status: "missing" };

export type PassportFileStoreErrorCode =
  | "unauthorized"
  | "forbidden"
  | "network_failed"
  | "invalid_response"
  | "invalid_file"
  | "duplicate_files"
  | "create_conflict"
  | "stale_file"
  | "write_failed"
  | "delete_failed";

export type PassportFileStoreResult<T> = Result<T, { code: PassportFileStoreErrorCode }>;

export type PassportFileStore = {
  readPassportFile(): Promise<PassportFileStoreResult<PassportFileReadResult>>;
  createPassportFile(input: { envelope: PassportFileEnvelopeV1 }): Promise<PassportFileStoreResult<PassportFileReference>>;
  deletePassportFile(input: { reference: PassportFileReference }): Promise<PassportFileStoreResult<void>>;
};

export type PassportFileCryptoErrorCode =
  | "unsupported_browser_crypto"
  | "invalid_wrapping_key"
  | "invalid_plaintext"
  | "invalid_envelope"
  | "encrypt_failed"
  | "decrypt_failed";

export type PassportFileCryptoResult<T> = Result<T, { code: PassportFileCryptoErrorCode }>;

export type PassportFileCrypto = {
  encryptSecretKeyBytes(input: {
    secretKeyBytes: Uint8Array;
    wrappingKey: string;
    passportUrl: string;
  }): Promise<PassportFileCryptoResult<PassportFileEnvelopeV1>>;
  decryptSecretKeyBytes(input: {
    envelope: PassportFileEnvelopeV1;
    wrappingKey: string;
    passportUrl: string;
  }): Promise<PassportFileCryptoResult<Uint8Array>>;
};
