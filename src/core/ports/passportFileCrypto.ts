import type { PassportFileEnvelopeV1 } from "../domain/passport-file/passportFile";

export type PassportFileCryptoErrorCode =
  | "unsupported_browser_crypto"
  | "invalid_wrapping_key"
  | "invalid_plaintext"
  | "invalid_envelope"
  | "encrypt_failed"
  | "decrypt_failed";

export type PassportFileCryptoError = {
  code: PassportFileCryptoErrorCode;
};

export type PassportFileCryptoResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PassportFileCryptoError };

export interface PassportFileCrypto {
  encryptSecretKeyBytes(input: {
    secretKeyBytes: Uint8Array;
    wrappingKey: string;
    passportUrl: string;
  }): Promise<PassportFileCryptoResult<PassportFileEnvelopeV1>>;

  decryptSecretKeyBytes(input: {
    envelope: PassportFileEnvelopeV1;
    wrappingKey: string;
  }): Promise<PassportFileCryptoResult<Uint8Array>>;
}
