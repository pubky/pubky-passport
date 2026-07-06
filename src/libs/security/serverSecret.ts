const minimumServerSecretBytes = 32;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function isBase64(value: string): boolean {
  return base64Pattern.test(value);
}

export function hasMinimumServerSecretBytes(value: Uint8Array): boolean {
  return value.byteLength >= minimumServerSecretBytes;
}

export function minimumServerSecretByteLength(): number {
  return minimumServerSecretBytes;
}
