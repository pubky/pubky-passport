declare const pubkyIdentityKeyHandleBrand: unique symbol;

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

export type PubkyRecoveryFileMaterial = {
  bytes: Uint8Array;
  format: "pubky-recovery-file";
  sdkVersion: string;
};

export type PubkyIdentitySession = {
  publicIdentity: PubkyPublicIdentity;
  capabilities: string[];
  sessionSnapshot: string;
};

export type ValidatedSensitivePubkyAuthRequest = {
  sensitivePubkyAuthUrl: string;
};
