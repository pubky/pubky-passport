const base64UrlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const unpaddedBase64UrlPattern = /^[A-Za-z0-9_-]*$/;

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return globalThis.btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!isCanonicalBase64Url(value)) {
    return undefined;
  }

  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");

  try {
    const binary = globalThis.atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

export function isCanonicalBase64Url(value: string): boolean {
  if (!unpaddedBase64UrlPattern.test(value) || value.length % 4 === 1) {
    return false;
  }

  const remainder = value.length % 4;
  if (remainder === 0) return true;

  const terminalValue = base64UrlAlphabet.indexOf(value.at(-1) ?? "");
  return remainder === 2 ? terminalValue % 16 === 0 : terminalValue % 4 === 0;
}
