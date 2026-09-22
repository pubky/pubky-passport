export function shortPublicKey(publicKey: string): string {
  return publicKey.length > 12 ? `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}` : publicKey;
}

export function shortCopiedValue(value: string): string {
  return value.length > 32 ? `${value.slice(0, 32)}...` : value;
}
