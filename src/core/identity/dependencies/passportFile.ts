import type { Result } from "better-result";

import type { PassportFileEnvelopeV1 } from "../../passport-file/passportFile";

/**
 * Browser identity flows use these capabilities to protect and store a key.
 * Adapters may call Drive or WebCrypto; core code only sees these safe results.
 */
export type PassportFileReadResult = { status: "found"; envelope: PassportFileEnvelopeV1 } | { status: "missing" };

export type PassportFileStoreErrorCode =
  | "unauthorized"
  | "forbidden"
  | "network_failed"
  | "invalid_response"
  | "invalid_file"
  | "duplicate_files"
  | "write_failed";

export type PassportFileStoreResult<T> = Result<T, { code: PassportFileStoreErrorCode }>;

export type PassportFileStore = {
  readPassportFile(): Promise<PassportFileStoreResult<PassportFileReadResult>>;
  writePassportFile(input: { envelope: PassportFileEnvelopeV1 }): Promise<PassportFileStoreResult<void>>;
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
