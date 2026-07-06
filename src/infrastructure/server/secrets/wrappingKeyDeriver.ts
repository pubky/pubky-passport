import "server-only";

import { hkdfSync } from "node:crypto";

import type { WrappingKeyDeriver } from "../../../core/ports/wrappingKeyDeriver";
import { hasMinimumServerSecretBytes, isBase64 } from "../../../libs/security/serverSecret";

type ServerWrappingKeyDeriverOptions = {
  serverSecret: Uint8Array;
};

export type CreateServerWrappingKeyDeriverInput = {
  serverSecretBase64: string;
};

const wrappingKeyBytes = 32;
const hkdfSalt = Buffer.from("pubky-passport/wrapping-key/salt/v1", "utf8");

export class ServerWrappingKeyDeriver implements WrappingKeyDeriver {
  private readonly serverSecret: Buffer;

  constructor(options: ServerWrappingKeyDeriverOptions) {
    if (!hasMinimumServerSecretBytes(options.serverSecret)) {
      throw invalidConfigurationError();
    }

    this.serverSecret = Buffer.from(options.serverSecret);
  }

  async deriveWrappingKey(input: { issuer: string; subject: string }): Promise<{ wrappingKey: string }> {
    const { issuer, subject } = input;

    if (!issuer.trim() || !subject.trim()) {
      throw new Error("Invalid wrapping key identity.");
    }

    const info = Buffer.from(`google:${issuer}\n${subject}`, "utf8");
    const derivedKey = Buffer.from(hkdfSync("sha256", this.serverSecret, hkdfSalt, info, wrappingKeyBytes));

    return { wrappingKey: derivedKey.toString("base64url") };
  }
}

export function createServerWrappingKeyDeriver(
  input: CreateServerWrappingKeyDeriverInput,
): ServerWrappingKeyDeriver {
  return new ServerWrappingKeyDeriver({
    serverSecret: decodeServerSecret(input.serverSecretBase64),
  });
}

function decodeServerSecret(serverSecretBase64: string): Buffer {
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
