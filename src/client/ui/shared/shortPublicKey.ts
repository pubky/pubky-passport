/** Abbreviates a z-base-32 public key to its first and last four characters. */
function shortPublicKey(publicKey: string): string {
  return publicKey.length > 12 ? `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}` : publicKey;
}

export { shortPublicKey };
