import "server-only";

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

export function decodeServerSecret(serverSecretBase64: string): Buffer {
  if (!isBase64(serverSecretBase64)) {
    throw invalidConfigurationError();
  }

  const decoded = Buffer.from(serverSecretBase64, "base64");
  if (!hasMinimumServerSecretBytes(decoded)) {
    throw invalidConfigurationError();
  }

  return decoded;
}

function invalidConfigurationError(): Error {
  return new Error("Invalid wrapping key configuration.");
}
