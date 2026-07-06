import { Pubky, PublicKey, type PubkyError, type PubkyErrorName, type Session } from "@synonymdev/pubky";

import type { PubkyIdentitySession } from "../../../core/domain/identity/pubkyIdentity";
import {
  type PubkyIdentityKeyError,
  type PubkyIdentityKeypair,
  withPubkySdkKeypair,
} from "./pubkyIdentityKeyAdapter";

export type PubkyNetworkConfig =
  | { kind: "mainnet" }
  | { kind: "testnet"; host?: string | null };

export type PubkyIdentityOperationErrorCode =
  | "auth_approval_failed"
  | "discovery_publish_failed"
  | "invalid_homeserver_pubky"
  | "invalid_pubky_auth_request"
  | "key_unavailable"
  | "signin_failed"
  | "signup_failed";

export type PubkyIdentityOperationError = {
  code: PubkyIdentityOperationErrorCode;
  message: string;
  sdkErrorName?: PubkyErrorName;
};

export type PubkyIdentityOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PubkyIdentityOperationError };

export type PubkyIdentitySignupInput = {
  keypair: PubkyIdentityKeypair;
  homeserverPubky: string;
  signupCode?: string | null;
};

export type PubkyIdentitySigninInput = {
  keypair: PubkyIdentityKeypair;
  waitForDiscovery?: boolean;
};

export type PubkyIdentityDiscoveryInput = {
  keypair: PubkyIdentityKeypair;
  homeserverPubky?: string | null;
};

export type PubkyAuthApprovalInput = {
  keypair: PubkyIdentityKeypair;
  sensitivePubkyAuthUrl: string;
};

export class PubkyIdentityAdapter {
  readonly #pubky: Pubky;

  constructor(options: { network?: PubkyNetworkConfig } = {}) {
    this.#pubky = createPubky(options.network ?? { kind: "mainnet" });
  }

  async signup(input: PubkyIdentitySignupInput): Promise<PubkyIdentityOperationResult<PubkyIdentitySession>> {
    const homeserver = parsePublicKey(input.homeserverPubky);

    if (!homeserver.ok) {
      return homeserver;
    }

    try {
      return await this.withSigner(input.keypair, async (signer) => {
        const session = await signer.signup(homeserver.value, input.signupCode ?? null);

        return sessionDetails(session);
      }, "signup_failed", "Pubky identity signup failed.");
    } finally {
      homeserver.value.free();
    }
  }

  async signin(input: PubkyIdentitySigninInput): Promise<PubkyIdentityOperationResult<PubkyIdentitySession>> {
    return this.withSigner(input.keypair, async (signer) => {
      const session = input.waitForDiscovery ? await signer.signinBlocking() : await signer.signin();

      return sessionDetails(session);
    }, "signin_failed", "Pubky identity signin failed.");
  }

  async publishHomeserverIfStale(input: PubkyIdentityDiscoveryInput): Promise<PubkyIdentityOperationResult<void>> {
    return this.publishHomeserver(input, "if_stale");
  }

  async publishHomeserverForce(input: PubkyIdentityDiscoveryInput): Promise<PubkyIdentityOperationResult<void>> {
    return this.publishHomeserver(input, "force");
  }

  async approveAuthRequest(input: PubkyAuthApprovalInput): Promise<PubkyIdentityOperationResult<void>> {
    if (!isPubkyAuthRequestUrl(input.sensitivePubkyAuthUrl)) {
      return failure("invalid_pubky_auth_request", "Pubky auth request URL is missing or invalid.");
    }

    return this.withSigner(input.keypair, async (signer) => {
      await signer.approveAuthRequest(input.sensitivePubkyAuthUrl);
    }, "auth_approval_failed", "Pubky auth request approval failed.");
  }

  dispose(): void {
    this.#pubky.free();
  }

  private async publishHomeserver(
    input: PubkyIdentityDiscoveryInput,
    mode: "force" | "if_stale",
  ): Promise<PubkyIdentityOperationResult<void>> {
    const homeserver = parseOptionalPublicKey(input.homeserverPubky);
    let homeserverTransferredToSdk = false;

    if (!homeserver.ok) {
      return homeserver;
    }

    try {
      return await this.withSigner(input.keypair, async (signer) => {
        const pkdns = signer.pkdns;

        try {
          if (mode === "force") {
            homeserverTransferredToSdk = homeserver.value !== null;
            await pkdns.publishHomeserverForce(homeserver.value);
            return;
          }

          homeserverTransferredToSdk = homeserver.value !== null;
          await pkdns.publishHomeserverIfStale(homeserver.value);
        } finally {
          pkdns.free();
        }
      }, "discovery_publish_failed", "Pubky homeserver discovery publication failed.");
    } finally {
      if (!homeserverTransferredToSdk) {
        homeserver.value?.free();
      }
    }
  }

  private async withSigner<T>(
    keypair: PubkyIdentityKeypair,
    handleSigner: (signer: ReturnType<Pubky["signer"]>) => Promise<T>,
    failureCode: PubkyIdentityOperationErrorCode,
    failureMessage: string,
  ): Promise<PubkyIdentityOperationResult<T>> {
    const sdkKeypair = withPubkySdkKeypair(keypair, (value) => value);

    if (!sdkKeypair.ok) {
      return keyFailure(sdkKeypair.error, failureCode);
    }

    const signer = this.#pubky.signer(sdkKeypair.value);

    try {
      return { ok: true, value: await handleSigner(signer) };
    } catch (error) {
      return failure(failureCode, failureMessage, pubkyErrorName(error));
    } finally {
      signer.free();
    }
  }
}

function createPubky(network: PubkyNetworkConfig): Pubky {
  if (network.kind === "testnet") {
    return Pubky.testnet(network.host ?? null);
  }

  return new Pubky();
}

function sessionDetails(session: Session): PubkyIdentitySession {
  const info = session.info;
  const publicKey = info.publicKey;

  try {
    return {
      publicIdentity: {
        publicKeyZ32: publicKey.z32(),
        publicKeyDisplay: publicKey.toString(),
      },
      capabilities: [...info.capabilities],
      sessionSnapshot: session.export(),
    };
  } finally {
    publicKey.free();
    info.free();
    session.free();
  }
}

function parsePublicKey(value: string): PubkyIdentityOperationResult<PublicKey> {
  if (value.trim().length === 0) {
    return failure("invalid_homeserver_pubky", "Homeserver public key is missing or invalid.");
  }

  try {
    return { ok: true, value: PublicKey.from(value) };
  } catch (error) {
    return failure("invalid_homeserver_pubky", "Homeserver public key is missing or invalid.", pubkyErrorName(error));
  }
}

function parseOptionalPublicKey(value: string | null | undefined): PubkyIdentityOperationResult<PublicKey | null> {
  if (value === null || value === undefined) {
    return { ok: true, value: null };
  }

  return parsePublicKey(value);
}

function isPubkyAuthRequestUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "pubkyauth:";
  } catch {
    return false;
  }
}

function keyFailure(
  error: PubkyIdentityKeyError,
  code: PubkyIdentityOperationErrorCode,
): PubkyIdentityOperationResult<never> {
  if (error.code === "key_unavailable") {
    return failure("key_unavailable", error.message);
  }

  return {
    ok: false,
    error: {
      code,
      message: error.message,
    },
  };
}

function failure<T>(
  code: PubkyIdentityOperationErrorCode,
  message: string,
  sdkErrorName?: PubkyErrorName,
): PubkyIdentityOperationResult<T> {
  return { ok: false, error: { code, message, ...(sdkErrorName ? { sdkErrorName } : {}) } };
}

function pubkyErrorName(error: unknown): PubkyErrorName | undefined {
  if (!isPubkyError(error)) {
    return undefined;
  }

  return error.name;
}

function isPubkyError(error: unknown): error is PubkyError {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string" &&
    isPubkyErrorName(error.name)
  );
}

function isPubkyErrorName(value: string): value is PubkyErrorName {
  return (
    value === "AuthenticationError" ||
    value === "ClientStateError" ||
    value === "InternalError" ||
    value === "InvalidInput" ||
    value === "PkarrError" ||
    value === "RequestError"
  );
}
