import "client-only";

import type {
  PubkyIdentityKey,
  PubkyIdentityKeyHandle,
  PubkyIdentitySession,
  PubkySecretKeyMaterial,
} from "../../../core/domain/identity/pubkyIdentity";
import type {
  ExportPubkySecretKeyInput,
  GetPubkyPublicIdentityInput,
  PubkyIdentityKeys,
  PubkyIdentityKeysErrorCode,
  PubkyIdentityKeysResult,
  RestorePubkyIdentityKeyInput,
} from "../../../core/ports/pubkyIdentityKeys";
import type {
  PubkySignup,
  PubkySignupErrorCode,
  PubkySignupResult,
  SigninWithPubkyInput,
  SignupWithPubkyInput,
} from "../../../core/ports/pubkySignup";
import type {
  PubkyDiscovery,
  PubkyDiscoveryErrorCode,
  PubkyDiscoveryResult,
  PublishPubkyHomeserverInput,
} from "../../../core/ports/pubkyDiscovery";
import type {
  ApprovePubkyAuthRequestInput,
  PubkyAuthApproval,
  PubkyAuthApprovalErrorCode,
  PubkyAuthApprovalResult,
} from "../../../core/ports/pubkyAuthApproval";
import {
  PubkyIdentityKeyAdapter,
  type PubkyIdentityKeyErrorCode,
  type PubkyIdentityKeypair,
  type PubkyIdentityKeyResult,
} from "./pubkyIdentityKeyAdapter";
import {
  PubkyIdentityAdapter,
  type PubkyIdentityOperationErrorCode,
  type PubkyIdentityOperationResult,
} from "./pubkyIdentityAdapter";

export class BrowserPubkyIdentityKeys implements PubkyIdentityKeys {
  readonly #keyAdapter: PubkyIdentityKeyAdapter;
  readonly #keypairs = new Map<PubkyIdentityKeyHandle, PubkyIdentityKeypair>();
  #disposed = false;

  constructor(keyAdapter = new PubkyIdentityKeyAdapter()) {
    this.#keyAdapter = keyAdapter;
  }

  async createIdentityKey(): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>> {
    if (this.#disposed) {
      return keyFailure("key_unavailable");
    }

    const created = this.#keyAdapter.createKeypair();

    if (!created.ok) {
      return keyFailure(mapIdentityKeyErrorCode(created.error.code));
    }

    return this.storeKeypair(created.value);
  }

  async restoreIdentityKey(input: RestorePubkyIdentityKeyInput): Promise<PubkyIdentityKeysResult<PubkyIdentityKey>> {
    if (this.#disposed) {
      input.secretKey.bytes.fill(0);
      return keyFailure("key_unavailable");
    }

    const restored = this.#keyAdapter.restoreKeypair({
      secretKeyBytes: input.secretKey.bytes,
    });

    if (!restored.ok) {
      return keyFailure(mapIdentityKeyErrorCode(restored.error.code));
    }

    return this.storeKeypair(restored.value);
  }

  async exportSecretKey(input: ExportPubkySecretKeyInput): Promise<PubkyIdentityKeysResult<PubkySecretKeyMaterial>> {
    const keypair = this.#keypairs.get(input.keyHandle);

    if (!keypair) {
      return keyFailure("key_unavailable");
    }

    const exported = this.#keyAdapter.exportSecretKey(keypair);

    if (!exported.ok) {
      return keyFailure(mapIdentityKeyErrorCode(exported.error.code));
    }

    return {
      ok: true,
      value: {
        bytes: exported.value.bytes,
        format: exported.value.format,
      },
    };
  }

  async getPublicIdentity(input: GetPubkyPublicIdentityInput): Promise<PubkyIdentityKeysResult<PubkyIdentityKey["publicIdentity"]>> {
    const keypair = this.#keypairs.get(input.keyHandle);

    if (!keypair) {
      return keyFailure("key_unavailable");
    }

    const publicIdentity = this.#keyAdapter.getPublicIdentity(keypair);

    if (!publicIdentity.ok) {
      return keyFailure(mapIdentityKeyErrorCode(publicIdentity.error.code));
    }

    return { ok: true, value: publicIdentity.value };
  }

  keypairForHandle(keyHandle: PubkyIdentityKeyHandle): PubkyIdentityKeyResult<PubkyIdentityKeypair> {
    const keypair = this.#keypairs.get(keyHandle);

    if (!keypair) {
      return {
        ok: false,
        error: {
          code: "key_unavailable",
          message: "Pubky identity keypair is not available.",
        },
      };
    }

    return { ok: true, value: keypair };
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;

    for (const keypair of this.#keypairs.values()) {
      keypair.dispose();
    }

    this.#keypairs.clear();
  }

  private storeKeypair(keypair: PubkyIdentityKeypair): PubkyIdentityKeysResult<PubkyIdentityKey> {
    const publicIdentity = this.#keyAdapter.getPublicIdentity(keypair);

    if (!publicIdentity.ok) {
      keypair.dispose();
      return keyFailure(mapIdentityKeyErrorCode(publicIdentity.error.code));
    }

    const keyHandle = {} as PubkyIdentityKeyHandle;

    this.#keypairs.set(keyHandle, keypair);

    return { ok: true, value: { keyHandle, publicIdentity: publicIdentity.value } };
  }
}

export class BrowserPubkyIdentity implements PubkySignup, PubkyDiscovery, PubkyAuthApproval {
  readonly #identityAdapter: PubkyIdentityAdapter;
  readonly #identityKeys: BrowserPubkyIdentityKeys;
  #disposed = false;

  constructor(identityKeys: BrowserPubkyIdentityKeys, identityAdapter = new PubkyIdentityAdapter()) {
    this.#identityKeys = identityKeys;
    this.#identityAdapter = identityAdapter;
  }

  async signup(input: SignupWithPubkyInput): Promise<PubkySignupResult<PubkyIdentitySession>> {
    const keypair = this.#identityKeys.keypairForHandle(input.keyHandle);

    if (!keypair.ok) {
      return signupFailure(mapIdentityKeyToSignupErrorCode(keypair.error.code));
    }

    return mapSignupResult(
      await this.#identityAdapter.signup({
        keypair: keypair.value,
        homeserverPubky: input.homeserverPubky,
        ...(input.signupCode !== undefined ? { signupCode: input.signupCode } : {}),
      }),
    );
  }

  async signin(input: SigninWithPubkyInput): Promise<PubkySignupResult<PubkyIdentitySession>> {
    const keypair = this.#identityKeys.keypairForHandle(input.keyHandle);

    if (!keypair.ok) {
      return signupFailure(mapIdentityKeyToSignupErrorCode(keypair.error.code));
    }

    return mapSignupResult(
      await this.#identityAdapter.signin({
        keypair: keypair.value,
        ...(input.waitForDiscovery !== undefined ? { waitForDiscovery: input.waitForDiscovery } : {}),
      }),
    );
  }

  async publishHomeserverIfStale(input: PublishPubkyHomeserverInput): Promise<PubkyDiscoveryResult> {
    const keypair = this.#identityKeys.keypairForHandle(input.keyHandle);

    if (!keypair.ok) {
      return discoveryFailure(mapIdentityKeyToDiscoveryErrorCode(keypair.error.code));
    }

    return mapDiscoveryResult(
      await this.#identityAdapter.publishHomeserverIfStale({
        keypair: keypair.value,
        ...(input.homeserverPubky !== undefined ? { homeserverPubky: input.homeserverPubky } : {}),
      }),
    );
  }

  async publishHomeserverForce(input: PublishPubkyHomeserverInput): Promise<PubkyDiscoveryResult> {
    const keypair = this.#identityKeys.keypairForHandle(input.keyHandle);

    if (!keypair.ok) {
      return discoveryFailure(mapIdentityKeyToDiscoveryErrorCode(keypair.error.code));
    }

    return mapDiscoveryResult(
      await this.#identityAdapter.publishHomeserverForce({
        keypair: keypair.value,
        ...(input.homeserverPubky !== undefined ? { homeserverPubky: input.homeserverPubky } : {}),
      }),
    );
  }

  async approveAuthRequest(input: ApprovePubkyAuthRequestInput): Promise<PubkyAuthApprovalResult> {
    const keypair = this.#identityKeys.keypairForHandle(input.keyHandle);

    if (!keypair.ok) {
      return authApprovalFailure(mapIdentityKeyToAuthApprovalErrorCode(keypair.error.code));
    }

    return mapAuthApprovalResult(
      await this.#identityAdapter.approveAuthRequest({
        keypair: keypair.value,
        sensitivePubkyAuthUrl: input.authRequest.sensitivePubkyAuthUrl,
      }),
    );
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#identityKeys.dispose();
    this.#identityAdapter.dispose();
  }
}

export function mapIdentityKeyErrorCode(code: PubkyIdentityKeyErrorCode): PubkyIdentityKeysErrorCode {
  switch (code) {
    case "invalid_secret_key":
    case "key_unavailable":
      return code;
    case "keypair_creation_failed":
      return "create_failed";
    case "public_identity_failed":
      return "public_identity_failed";
    case "secret_export_failed":
      return "export_failed";
    case "secret_restore_failed":
      return "restore_failed";
  }
}

export function mapIdentityOperationToSignupErrorCode(code: PubkyIdentityOperationErrorCode): PubkySignupErrorCode {
  switch (code) {
    case "invalid_homeserver_pubky":
    case "key_unavailable":
    case "signin_failed":
    case "signup_failed":
      return code;
    case "auth_approval_failed":
    case "discovery_publish_failed":
    case "invalid_pubky_auth_request":
      return "signup_failed";
  }
}

export function mapIdentityOperationToDiscoveryErrorCode(code: PubkyIdentityOperationErrorCode): PubkyDiscoveryErrorCode {
  switch (code) {
    case "invalid_homeserver_pubky":
    case "key_unavailable":
      return code;
    case "auth_approval_failed":
    case "discovery_publish_failed":
    case "invalid_pubky_auth_request":
    case "signin_failed":
    case "signup_failed":
      return "publish_failed";
  }
}

export function mapIdentityOperationToAuthApprovalErrorCode(code: PubkyIdentityOperationErrorCode): PubkyAuthApprovalErrorCode {
  switch (code) {
    case "key_unavailable":
      return code;
    case "invalid_pubky_auth_request":
      return "request_rejected";
    case "auth_approval_failed":
    case "discovery_publish_failed":
    case "invalid_homeserver_pubky":
    case "signin_failed":
    case "signup_failed":
      return "approval_failed";
  }
}

function mapIdentityKeyToSignupErrorCode(code: PubkyIdentityKeyErrorCode): PubkySignupErrorCode {
  return code === "key_unavailable" ? "key_unavailable" : "signin_failed";
}

function mapIdentityKeyToDiscoveryErrorCode(code: PubkyIdentityKeyErrorCode): PubkyDiscoveryErrorCode {
  return code === "key_unavailable" ? "key_unavailable" : "publish_failed";
}

function mapIdentityKeyToAuthApprovalErrorCode(code: PubkyIdentityKeyErrorCode): PubkyAuthApprovalErrorCode {
  return code === "key_unavailable" ? "key_unavailable" : "approval_failed";
}

function mapSignupResult<T>(result: PubkyIdentityOperationResult<T>): PubkySignupResult<T> {
  if (result.ok) {
    return result;
  }

  return signupFailure(mapIdentityOperationToSignupErrorCode(result.error.code));
}

function mapDiscoveryResult(result: PubkyIdentityOperationResult<void>): PubkyDiscoveryResult {
  if (result.ok) {
    return { ok: true };
  }

  return discoveryFailure(mapIdentityOperationToDiscoveryErrorCode(result.error.code));
}

function mapAuthApprovalResult(result: PubkyIdentityOperationResult<void>): PubkyAuthApprovalResult {
  if (result.ok) {
    return { ok: true };
  }

  return authApprovalFailure(mapIdentityOperationToAuthApprovalErrorCode(result.error.code));
}

function keyFailure<T>(code: PubkyIdentityKeysErrorCode): PubkyIdentityKeysResult<T> {
  return { ok: false, error: { code } };
}

function signupFailure<T>(code: PubkySignupErrorCode): PubkySignupResult<T> {
  return { ok: false, error: { code } };
}

function discoveryFailure(code: PubkyDiscoveryErrorCode): PubkyDiscoveryResult {
  return { ok: false, error: { code } };
}

function authApprovalFailure(code: PubkyAuthApprovalErrorCode): PubkyAuthApprovalResult {
  return { ok: false, error: { code } };
}
