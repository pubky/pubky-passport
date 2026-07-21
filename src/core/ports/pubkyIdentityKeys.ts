import type { Result } from "better-result";

import type {
  PubkyIdentityKey,
  PubkyIdentityKeyHandle,
  PubkyPublicIdentity,
  PubkySecretKeyMaterial,
} from "../domain/identity/pubkyIdentity";

export type PubkyIdentityKeysErrorCode =
  | "create_failed"
  | "export_failed"
  | "invalid_secret_key"
  | "key_unavailable"
  | "public_identity_failed"
  | "restore_failed";

export type PubkyIdentityKeysError = {
  code: PubkyIdentityKeysErrorCode;
};

export type PubkyIdentityKeysResult<T> = Result<T, PubkyIdentityKeysError>;

export type RestorePubkyIdentityKeyInput = {
  secretKey: PubkySecretKeyMaterial;
};

export type ExportPubkySecretKeyInput = {
  keyHandle: PubkyIdentityKeyHandle;
};

export type GetPubkyPublicIdentityInput = {
  keyHandle: PubkyIdentityKeyHandle;
};

export interface PubkyIdentityKeys {
  createIdentityKey(): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>>;
  restoreIdentityKey(input: RestorePubkyIdentityKeyInput): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>>;
  exportSecretKey(input: ExportPubkySecretKeyInput): Promise<PubkyIdentityKeysResult<PubkySecretKeyMaterial>>;
  getPublicIdentity(input: GetPubkyPublicIdentityInput): Promise<PubkyIdentityKeysResult<PubkyPublicIdentity>>;
}
