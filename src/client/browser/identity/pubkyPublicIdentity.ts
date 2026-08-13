import "client-only";

/** Public metadata derived from a browser-owned Pubky keypair. */
export type PubkyPublicIdentity = {
  publicKeyZ32: string;
  publicKeyDisplay: string;
};
