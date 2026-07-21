import "server-only";

import { hkdfSync } from "node:crypto";

import type { IdentityProviderId } from "../../../features/identity/identityProvider";
import type { WrappingKeyDeriver } from "../wrappingKeyDependencies";
import { hasMinimumServerSecretBytes } from "../../../libs/security/serverSecret";
import { canonicalGoogleIssuer } from "../google/googleIssuer";
import { decodeWrappingKeyServerSecret } from "./serverSecret";

type ServerWrappingKeyDeriverOptions = {
  serverSecret: Uint8Array;
};

export type CreateServerWrappingKeyDeriverInput = {
  serverSecretBase64: string;
};

const wrappingKeyBytes = 32;
const hkdfSalt = Buffer.from("pubky-passport/wrapping-key/salt/v1", "utf8");
const hkdfInfoProviderPrefixes: Record<IdentityProviderId, string> = {
  google: "google:",
};

export class ServerWrappingKeyDeriver implements WrappingKeyDeriver {
  private readonly serverSecret: Buffer;

  constructor(options: ServerWrappingKeyDeriverOptions) {
    if (!hasMinimumServerSecretBytes(options.serverSecret)) {
      throw invalidConfigurationError();
    }

    this.serverSecret = Buffer.from(options.serverSecret);
  }

  async deriveWrappingKey(input: {
    provider: IdentityProviderId;
    issuer: string;
    subject: string;
  }): Promise<{ wrappingKey: string }> {
    const { provider, issuer, subject } = input;

    if (issuer !== canonicalGoogleIssuer || !subject.trim()) {
      throw new Error("Invalid wrapping key identity.");
    }

    const info = Buffer.from(`${hkdfInfoProviderPrefixes[provider]}${issuer}\n${subject}`, "utf8");
    const derivedKey = Buffer.from(hkdfSync("sha256", this.serverSecret, hkdfSalt, info, wrappingKeyBytes));

    return { wrappingKey: derivedKey.toString("base64url") };
  }
}

export function createServerWrappingKeyDeriver(
  input: CreateServerWrappingKeyDeriverInput,
): ServerWrappingKeyDeriver {
  return new ServerWrappingKeyDeriver({
    serverSecret: decodeWrappingKeyServerSecret(input.serverSecretBase64),
  });
}

function invalidConfigurationError(): Error {
  return new Error("Invalid wrapping key configuration.");
}
