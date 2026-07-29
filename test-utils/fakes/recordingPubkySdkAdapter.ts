import { Result } from "better-result";

import {
  PubkySdkAdapter,
  type PubkyDiscoveryInput,
  type PubkySignupInput,
} from "../../src/browser/pubky/adapters/pubkySdkAdapter";
import type { ValidatedSensitivePubkyAuthRequest } from "../../src/core/auth/parsePubkyAuthRequest";
import type { PubkyPublicIdentity } from "../../src/core/identity/pubkyIdentity";
import type { PubkyAuthApprovalErrorCode, PubkyAuthApprovalResult } from "../../src/browser/pubky/application/pubkyAuthApprovalResult";
import type { PubkyDiscoveryErrorCode, PubkyDiscoveryResult } from "../../src/browser/pubky/application/pubkyDiscoveryResult";
import {
  PUBKY_SECRET_KEY_BYTES,
  PUBKY_SECRET_KEY_FORMAT,
  type PubkyIdentityKey,
  type PubkyIdentityKeyHandle,
  type PubkyIdentityKeysErrorCode,
  type PubkyIdentityKeysResult,
  type PubkySecretKeyMaterial,
} from "../../src/browser/pubky/application/pubkyIdentityKey";
import type { PubkyIdentitySession, PubkySessionAccessErrorCode, PubkySessionAccessResult } from "../../src/browser/pubky/application/pubkyIdentitySession";

export class RecordingPubkySdkAdapter extends PubkySdkAdapter {
  createCalls = 0;
  restoreCalls: Array<{ secretKeyByteLength: number; secretKeyFormat: string }> = [];
  exportCalls = 0;
  publicIdentityCalls = 0;
  disposedKeys: PubkyIdentityKeyHandle[] = [];
  signupCalls: Array<{ homeserverPubky: string; hasSignupCode: boolean }> = [];
  signinCalls: Array<{ waitForDiscovery: boolean }> = [];
  discoveryCalls: Array<{ hasHomeserverPubky: boolean }> = [];
  approvalCalls: Array<{ scheme?: string; queryKeys: string[] }> = [];

  createFailure?: PubkyIdentityKeysErrorCode;
  restoreFailure?: PubkyIdentityKeysErrorCode;
  exportFailure?: PubkyIdentityKeysErrorCode;
  publicIdentityFailure?: PubkyIdentityKeysErrorCode;
  signupFailure?: PubkySessionAccessErrorCode;
  signinFailure?: PubkySessionAccessErrorCode;
  discoveryFailure?: PubkyDiscoveryErrorCode;
  approvalFailure?: PubkyAuthApprovalErrorCode;
  throwOnSignup = false;
  throwOnSignin = false;
  throwOnDiscovery = false;
  throwOnDisposeIdentity = false;

  nextPublicIdentity: PubkyPublicIdentity = {
    publicKeyZ32: "fakepubkyidentity1111111111111111111111111111111111111111111",
    publicKeyDisplay: "pubkyfakepubkyidentity1111111111111111111111111111111111111111111",
  };
  session: PubkyIdentitySession = { publicIdentity: this.nextPublicIdentity };
  secretKey: PubkySecretKeyMaterial = {
    bytes: new Uint8Array(Array.from({ length: PUBKY_SECRET_KEY_BYTES }, (_, index) => index + 1)),
    format: PUBKY_SECRET_KEY_FORMAT,
  };

  readonly #identities = new Map<PubkyIdentityKeyHandle, PubkyPublicIdentity>();

  override async createIdentityKey(): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>> {
    this.createCalls += 1;
    if (this.createFailure) return keyFailure(this.createFailure);
    return this.createRecordedKey();
  }

  override async restoreIdentityKey(secretKey: PubkySecretKeyMaterial): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>> {
    this.restoreCalls.push({
      secretKeyByteLength: secretKey.bytes.byteLength,
      secretKeyFormat: secretKey.format,
    });
    secretKey.bytes.fill(0);
    if (this.restoreFailure) return keyFailure(this.restoreFailure);
    return this.createRecordedKey();
  }

  override async exportSecretKey(keyHandle: PubkyIdentityKeyHandle): Promise<PubkyIdentityKeysResult<PubkySecretKeyMaterial>> {
    this.exportCalls += 1;
    if (this.exportFailure) return keyFailure(this.exportFailure);
    if (!this.#identities.has(keyHandle)) return keyFailure("key_unavailable");
    return Result.ok({ bytes: new Uint8Array(this.secretKey.bytes), format: this.secretKey.format });
  }

  override async getPublicIdentity(keyHandle: PubkyIdentityKeyHandle): Promise<PubkyIdentityKeysResult<PubkyPublicIdentity>> {
    this.publicIdentityCalls += 1;
    if (this.publicIdentityFailure) return keyFailure(this.publicIdentityFailure);
    const identity = this.#identities.get(keyHandle);
    return identity ? Result.ok(identity) : keyFailure("key_unavailable");
  }

  override disposeIdentityKey(keyHandle: PubkyIdentityKeyHandle): void {
    if (this.throwOnDisposeIdentity) throw new Error("cleanup failed");
    this.disposedKeys.push(keyHandle);
    this.#identities.delete(keyHandle);
    super.disposeIdentityKey(keyHandle);
  }

  override async signup(input: PubkySignupInput): Promise<PubkySessionAccessResult<PubkyIdentitySession>> {
    if (this.throwOnSignup) throw new Error("signup threw");
    this.signupCalls.push({
      homeserverPubky: input.homeserverPubky,
      hasSignupCode: Boolean(input.signupCode),
    });
    return this.signupFailure ? sessionFailure(this.signupFailure) : Result.ok(this.session);
  }

  override async signin(_keyHandle: PubkyIdentityKeyHandle, waitForDiscovery?: boolean): Promise<PubkySessionAccessResult<PubkyIdentitySession>> {
    if (this.throwOnSignin) throw new Error("signin threw");
    this.signinCalls.push({ waitForDiscovery: waitForDiscovery === true });
    return this.signinFailure ? sessionFailure(this.signinFailure) : Result.ok(this.session);
  }

  override async publishHomeserverIfStale(input: PubkyDiscoveryInput): Promise<PubkyDiscoveryResult> {
    if (this.throwOnDiscovery) throw new Error("discovery threw");
    this.discoveryCalls.push({ hasHomeserverPubky: Boolean(input.homeserverPubky) });
    return this.discoveryFailure ? Result.err({ code: this.discoveryFailure }) : Result.ok();
  }

  override async approveAuthRequest(
    _keyHandle: PubkyIdentityKeyHandle,
    authRequest: ValidatedSensitivePubkyAuthRequest,
  ): Promise<PubkyAuthApprovalResult> {
    let scheme: string | undefined;
    let queryKeys: string[] = [];
    try {
      const parsed = new URL(authRequest.sensitivePubkyAuthUrl);
      scheme = parsed.protocol;
      queryKeys = [...parsed.searchParams.keys()].sort();
    } catch {
      // Keep malformed sensitive input out of call history.
    }
    this.approvalCalls.push({ ...(scheme ? { scheme } : {}), queryKeys });
    return this.approvalFailure ? Result.err({ code: this.approvalFailure }) : Result.ok();
  }

  private async createRecordedKey(): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>> {
    const created = await super.createIdentityKey();
    if (Result.isError(created)) return created;
    this.#identities.set(created.value.keyHandle, this.nextPublicIdentity);
    return Result.ok({ keyHandle: created.value.keyHandle, publicIdentity: this.nextPublicIdentity });
  }
}

function keyFailure<T>(code: PubkyIdentityKeysErrorCode): PubkyIdentityKeysResult<T> {
  return Result.err({ code });
}

function sessionFailure<T>(code: PubkySessionAccessErrorCode): PubkySessionAccessResult<T> {
  return Result.err({ code });
}
