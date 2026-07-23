declare const pubkyIdentityKeyHandleBrand: unique symbol;

export const pubkySecretKeyBytes = 32;
export const pubkySecretKeyFormat = "pubky-secret-key";

export type PubkyPublicIdentity = {
  publicKeyZ32: string;
  publicKeyDisplay: string;
};

export type PubkyIdentityKeyHandle = {
  readonly [pubkyIdentityKeyHandleBrand]: "PubkyIdentityKeyHandle";
};

export type PubkyIdentityKey = {
  keyHandle: PubkyIdentityKeyHandle;
  publicIdentity: PubkyPublicIdentity;
};

export type PubkySecretKeyMaterial = {
  bytes: Uint8Array;
  format: typeof pubkySecretKeyFormat;
};

export type PubkyIdentitySession = {
  publicIdentity: PubkyPublicIdentity;
};
