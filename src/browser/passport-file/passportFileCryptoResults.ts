import "client-only";

import type { Result } from "better-result";

import type { PassportFileEnvelopeV1 } from "../../core/passport-file/passportFile";

export type PassportFileCryptoErrorCode =
  | "unsupported_browser_crypto"
  | "invalid_wrapping_key"
  | "invalid_plaintext"
  | "invalid_envelope"
  | "encrypt_failed"
  | "decrypt_failed";

export type PassportFileCryptoResult<T> = Result<T, { code: PassportFileCryptoErrorCode }>;

export type EncryptPassportSecretInput = {
  secretKeyBytes: Uint8Array;
  wrappingKey: string;
  passportOrigin: string;
};

export type DecryptPassportSecretInput = {
  envelope: PassportFileEnvelopeV1;
  wrappingKey: string;
  passportOrigin: string;
};

export type EncryptPassportSecret = (
  input: EncryptPassportSecretInput,
) => Promise<PassportFileCryptoResult<PassportFileEnvelopeV1>>;

export type DecryptPassportSecret = (
  input: DecryptPassportSecretInput,
) => Promise<PassportFileCryptoResult<Uint8Array>>;
