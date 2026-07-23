import "client-only";

import type { Result } from "better-result";

import type { PassportFileEnvelopeV1 } from "../../features/passport-file/passportFile";
import type {
  PubkyIdentityKey,
  PubkyIdentityKeyHandle,
  PubkyIdentitySession,
  PubkyPublicIdentity,
  PubkySecretKeyMaterial,
} from "../../features/identity/pubkyIdentity";

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

export type PubkyIdentityKeysErrorCode =
  | "create_failed"
  | "export_failed"
  | "invalid_secret_key"
  | "key_unavailable"
  | "public_identity_failed"
  | "restore_failed";

export type PubkyIdentityKeysResult<T> = Result<T, { code: PubkyIdentityKeysErrorCode }>;

export type PubkyIdentityKeys = {
  createIdentityKey(): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>>;
  restoreIdentityKey(input: { secretKey: PubkySecretKeyMaterial }): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>>;
  disposeIdentityKey(input: { keyHandle: PubkyIdentityKeyHandle }): void;
  exportSecretKey(input: { keyHandle: PubkyIdentityKeyHandle }): Promise<PubkyIdentityKeysResult<PubkySecretKeyMaterial>>;
  getPublicIdentity(input: { keyHandle: PubkyIdentityKeyHandle }): Promise<PubkyIdentityKeysResult<PubkyPublicIdentity>>;
};

export type PubkySignupErrorCode = "invalid_homeserver_pubky" | "key_unavailable" | "signin_failed" | "signup_failed";
export type PubkySignupResult<T> = Result<T, { code: PubkySignupErrorCode }>;

export type PubkySignup = {
  signup(input: {
    keyHandle: PubkyIdentityKeyHandle;
    homeserverPubky: string;
    signupCode?: string | null;
  }): Promise<PubkySignupResult<PubkyIdentitySession>>;
  signin(input: { keyHandle: PubkyIdentityKeyHandle; waitForDiscovery?: boolean }): Promise<PubkySignupResult<PubkyIdentitySession>>;
};

export type PubkyDiscoveryErrorCode = "invalid_homeserver_pubky" | "key_unavailable" | "publish_failed";
export type PubkyDiscoveryResult = Result<void, { code: PubkyDiscoveryErrorCode }>;

export type PubkyDiscovery = {
  publishHomeserverIfStale(input: { keyHandle: PubkyIdentityKeyHandle; homeserverPubky?: string | null }): Promise<PubkyDiscoveryResult>;
  publishHomeserverForce(input: { keyHandle: PubkyIdentityKeyHandle; homeserverPubky?: string | null }): Promise<PubkyDiscoveryResult>;
};
