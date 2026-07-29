import "client-only";

import { Keypair, Pubky, PublicKey, type Session } from "@synonymdev/pubky";
import { Result, type Result as ResultType } from "better-result";

import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";
import {
  isParserIssuedPubkyAuthRequest,
  type ValidatedSensitivePubkyAuthRequest,
} from "../../../core/auth/parsePubkyAuthRequest";
import {
  type PubkyAuthApproval,
  type PubkyAuthApprovalErrorCode,
  type PubkyAuthApprovalResult,
} from "../application/pubkyAuthApproval";
import {
  type PubkyDiscovery,
  type PubkyDiscoveryErrorCode,
  type PubkyDiscoveryResult,
} from "../application/pubkyDiscovery";
import {
  PUBKY_SECRET_KEY_BYTES,
  PUBKY_SECRET_KEY_FORMAT,
  type PubkyIdentityKey,
  type PubkyIdentityKeyHandle,
  type PubkyIdentityKeys,
  type PubkyIdentityKeysErrorCode,
  type PubkyIdentityKeysResult,
  type PubkySecretKeyMaterial,
} from "../application/pubkyIdentityKeys";
import {
  type PubkyIdentitySession,
  type PubkySessionAccess,
  type PubkySessionAccessErrorCode,
  type PubkySessionAccessResult,
} from "../application/pubkySessionAccess";
import { LOGGER } from "../../../libs/logger/logger";

type Signer = ReturnType<Pubky["signer"]>;
type HomeserverResult = ResultType<PublicKey, { code: "invalid_homeserver_pubky" }>;

/**
 * Browser-local Pubky adapter. Opaque handles keep SDK keypairs out of application and
 * UI state while this adapter owns all SDK resource cleanup.
 */
export class PubkySdkAdapter implements PubkyIdentityKeys, PubkySessionAccess, PubkyDiscovery, PubkyAuthApproval {
  readonly #pubky: Pubky;
  readonly #keypairs = new Map<PubkyIdentityKeyHandle, Keypair>();
  #disposed = false;

  constructor() {
    this.#pubky = new Pubky();
  }

  async createIdentityKey(): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>> {
    if (this.#disposed) {
      return keyFailure("key_unavailable");
    }

    try {
      return this.registerKeypair(Keypair.random());
    } catch {
      return keyFailure("create_failed");
    }
  }

  async restoreIdentityKey(input: { secretKey: PubkySecretKeyMaterial }): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>> {
    if (this.#disposed) {
      input.secretKey.bytes.fill(0);
      return keyFailure("key_unavailable");
    }

    if (!(input.secretKey.bytes instanceof Uint8Array) || input.secretKey.bytes.byteLength !== PUBKY_SECRET_KEY_BYTES) {
      input.secretKey.bytes.fill(0);
      return keyFailure("invalid_secret_key");
    }

    try {
      return this.registerKeypair(Keypair.fromSecret(input.secretKey.bytes));
    } catch {
      return keyFailure("restore_failed");
    } finally {
      input.secretKey.bytes.fill(0);
    }
  }

  disposeIdentityKey(input: { keyHandle: PubkyIdentityKeyHandle }): void {
    const keypair = this.#keypairs.get(input.keyHandle);
    if (!keypair) return;
    this.#keypairs.delete(input.keyHandle);
    try {
      keypair.free();
    } catch {
      LOGGER.warn("identity.pubky.cleanup.failed", { operation: "keypair_free" });
    }
  }

  async exportSecretKey(input: { keyHandle: PubkyIdentityKeyHandle }): Promise<PubkyIdentityKeysResult<PubkySecretKeyMaterial>> {
    const keypair = this.keypairFor(input.keyHandle);
    if (!keypair) {
      return keyFailure("key_unavailable");
    }

    try {
      return Result.ok({
        bytes: keypair.secret(),
        format: PUBKY_SECRET_KEY_FORMAT,
      });
    } catch {
      return keyFailure("export_failed");
    }
  }

  async getPublicIdentity(input: { keyHandle: PubkyIdentityKeyHandle }): Promise<PubkyIdentityKeysResult<PubkyPublicIdentity>> {
    const keypair = this.keypairFor(input.keyHandle);
    if (!keypair) {
      return keyFailure("key_unavailable");
    }

    return publicIdentity(keypair);
  }

  async signup(input: { keyHandle: PubkyIdentityKeyHandle; homeserverPubky: string; signupCode?: string | null }): Promise<PubkySessionAccessResult<PubkyIdentitySession>> {
    const keypair = this.keypairFor(input.keyHandle);
    if (!keypair) {
      return sessionAccessFailure("key_unavailable");
    }

    const homeserver = parseHomeserver(input.homeserverPubky);
    if (Result.isError(homeserver)) {
      return Result.err(homeserver.error);
    }

    try {
      const session = await this.withSigner(keypair, (signer) => signer.signup(homeserver.value, input.signupCode ?? null));

      return Result.ok(sessionDetails(session));
    } catch {
      return sessionAccessFailure("signup_failed");
    } finally {
      homeserver.value.free();
    }
  }

  async signin(input: { keyHandle: PubkyIdentityKeyHandle; waitForDiscovery?: boolean }): Promise<PubkySessionAccessResult<PubkyIdentitySession>> {
    const keypair = this.keypairFor(input.keyHandle);
    if (!keypair) {
      return sessionAccessFailure("key_unavailable");
    }

    try {
      const session = await this.withSigner(keypair, (signer) => input.waitForDiscovery ? signer.signinBlocking() : signer.signin());

      return Result.ok(sessionDetails(session));
    } catch {
      return sessionAccessFailure("signin_failed");
    }
  }

  async publishHomeserverIfStale(input: { keyHandle: PubkyIdentityKeyHandle; homeserverPubky?: string | null }): Promise<PubkyDiscoveryResult> {
    return this.publishHomeserver(input);
  }

  async approveAuthRequest(input: { keyHandle: PubkyIdentityKeyHandle; authRequest: ValidatedSensitivePubkyAuthRequest }): Promise<PubkyAuthApprovalResult> {
    if (
      !isParserIssuedPubkyAuthRequest(input.authRequest) ||
      !isPubkyAuthRequestUrl(input.authRequest.sensitivePubkyAuthUrl)
    ) {
      return authApprovalFailure("request_rejected");
    }

    const keypair = this.keypairFor(input.keyHandle);
    if (!keypair) {
      return authApprovalFailure("key_unavailable");
    }

    try {
      await this.withSigner(keypair, (signer) => signer.approveAuthRequest(input.authRequest.sensitivePubkyAuthUrl));

      return Result.ok();
    } catch {
      return authApprovalFailure("approval_failed");
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    const keypairs = [...this.#keypairs.values()];
    this.#keypairs.clear();
    for (const keypair of keypairs) {
      try {
        keypair.free();
      } catch {
        LOGGER.warn("identity.pubky.cleanup.failed", { operation: "keypair_free" });
      }
    }
    try {
      this.#pubky.free();
    } catch {
      LOGGER.warn("identity.pubky.cleanup.failed", { operation: "pubky_free" });
    }
  }

  private registerKeypair(keypair: Keypair): PubkyIdentityKeysResult<PubkyIdentityKey> {
    const identity = publicIdentity(keypair);
    if (Result.isError(identity)) {
      keypair.free();
      return keyFailure(identity.error.code);
    }

    const keyHandle = {} as PubkyIdentityKeyHandle;
    this.#keypairs.set(keyHandle, keypair);

    return Result.ok({ keyHandle, publicIdentity: identity.value });
  }

  private async publishHomeserver(
    input: { keyHandle: PubkyIdentityKeyHandle; homeserverPubky?: string | null },
  ): Promise<PubkyDiscoveryResult> {
    const keypair = this.keypairFor(input.keyHandle);
    if (!keypair) {
      return discoveryFailure("key_unavailable");
    }

    const homeserver = parseOptionalHomeserver(input.homeserverPubky);
    if (Result.isError(homeserver)) {
      return Result.err(homeserver.error);
    }

    let transferredToSdk = false;
    try {
      await this.withSigner(keypair, async (signer) => {
        const pkdns = signer.pkdns;
        try {
          transferredToSdk = homeserver.value !== null;
          await pkdns.publishHomeserverIfStale(homeserver.value);
        } finally {
          pkdns.free();
        }
      });

      return Result.ok();
    } catch {
      return discoveryFailure("publish_failed");
    } finally {
      if (!transferredToSdk) {
        homeserver.value?.free();
      }
    }
  }

  private keypairFor(keyHandle: PubkyIdentityKeyHandle): Keypair | undefined {
    return this.#disposed ? undefined : this.#keypairs.get(keyHandle);
  }

  private async withSigner<T>(keypair: Keypair, operation: (signer: Signer) => Promise<T>): Promise<T> {
    const signer = this.#pubky.signer(keypair);
    try {
      return await operation(signer);
    } finally {
      signer.free();
    }
  }
}

function publicIdentity(keypair: Keypair): PubkyIdentityKeysResult<PubkyPublicIdentity> {
  try {
    const publicKey = keypair.publicKey;
    try {
      return Result.ok({
        publicKeyZ32: publicKey.z32(),
        publicKeyDisplay: publicKey.toString(),
      });
    } finally {
      publicKey.free();
    }
  } catch {
    return keyFailure("public_identity_failed");
  }
}

function parseHomeserver(value: string): HomeserverResult {
  if (value.trim().length === 0) {
    return Result.err({ code: "invalid_homeserver_pubky" });
  }

  try {
    return Result.ok(PublicKey.from(value));
  } catch {
    return Result.err({ code: "invalid_homeserver_pubky" });
  }
}

function parseOptionalHomeserver(value: string | null | undefined): ResultType<PublicKey | null, { code: "invalid_homeserver_pubky" }> {
  return value === null || value === undefined ? Result.ok(null) : parseHomeserver(value);
}

function isPubkyAuthRequestUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "pubkyauth:";
  } catch {
    return false;
  }
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
    };
  } finally {
    publicKey.free();
    info.free();
    session.free();
  }
}

function keyFailure<T>(code: PubkyIdentityKeysErrorCode): PubkyIdentityKeysResult<T> {
  return Result.err({ code });
}

function sessionAccessFailure<T>(code: PubkySessionAccessErrorCode): PubkySessionAccessResult<T> {
  return Result.err({ code });
}

function discoveryFailure(code: PubkyDiscoveryErrorCode): PubkyDiscoveryResult {
  return Result.err({ code });
}

function authApprovalFailure(code: PubkyAuthApprovalErrorCode): PubkyAuthApprovalResult {
  return Result.err({ code });
}
