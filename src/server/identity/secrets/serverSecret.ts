import "server-only";

import { hasMinimumServerSecretBytes, isBase64 } from "../../../libs/security/serverSecret";

export function decodeWrappingKeyServerSecret(serverSecretBase64: string): Buffer {
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
