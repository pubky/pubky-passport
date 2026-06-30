import type {
  PubkyIdentityKey,
  PubkyIdentityKeyHandle,
  PubkyPublicIdentity,
  PubkyRecoveryFileMaterial,
} from "../domain/identity/pubkyIdentity";

export type PubkyIdentityKeysErrorCode =
  | "create_failed"
  | "export_failed"
  | "invalid_passphrase"
  | "invalid_recovery_file"
  | "key_unavailable"
  | "public_identity_failed"
  | "restore_failed";

export type PubkyIdentityKeysError = {
  code: PubkyIdentityKeysErrorCode;
};

export type PubkyIdentityKeysResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PubkyIdentityKeysError };

export type RestorePubkyIdentityKeyInput = {
  recoveryFile: PubkyRecoveryFileMaterial;
  recoveryPassphrase: string;
};

export type ExportPubkyRecoveryFileInput = {
  keyHandle: PubkyIdentityKeyHandle;
  recoveryPassphrase: string;
};

export type GetPubkyPublicIdentityInput = {
  keyHandle: PubkyIdentityKeyHandle;
};

export interface PubkyIdentityKeys {
  createIdentityKey(): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>>;
  restoreIdentityKey(input: RestorePubkyIdentityKeyInput): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>>;
  exportRecoveryFile(input: ExportPubkyRecoveryFileInput): Promise<PubkyIdentityKeysResult<PubkyRecoveryFileMaterial>>;
  getPublicIdentity(input: GetPubkyPublicIdentityInput): Promise<PubkyIdentityKeysResult<PubkyPublicIdentity>>;
}
