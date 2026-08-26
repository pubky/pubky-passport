import {
  AuthFlowKind,
  Keypair,
  Pkdns,
  Pubky,
  PublicKey,
  Signer,
  type Session,
  validateCapabilities,
} from "@synonymdev/pubky";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Result, type Result as ResultType } from "better-result";

import { IssuedPubkyAuthRequest } from "../authorization/request/IssuedPubkyAuthRequest";
import { PUBKY_AUTH_REQUEST_LIMITS } from "../authorization/request/pubkyAuthRequestLimits";
import { LOGGER } from "../../../libs/logger/logger";
import { PUBKY_SECRET_KEY_BYTES, PUBKY_SECRET_KEY_FORMAT, type PubkyIdentityKeyHandle } from "./pubkyIdentityKey";
import { PubkySdkAdapter } from "./PubkySdkAdapter";

afterEach(() => vi.restoreAllMocks());

describe("PubkySdkAdapter", () => {
  it("accepts SDK-generated v0.10 cookie and grant authorization links", async () => {
    const relyingParty = new Pubky();
    const cookieFlow = relyingParty.startCookieAuthFlow(
      "/pub/passport.test/:rw",
      AuthFlowKind.signin(),
      "https://relay.example/inbox",
    );
    const grantFlow = await relyingParty.startGrantAuthFlow(
      "/pub/passport.test/:rw",
      AuthFlowKind.signin(),
      { clientId: "passport.test", relay: "https://relay.example/inbox" },
    );

    try {
      const cookie = IssuedPubkyAuthRequest.issue(encodeURIComponent(cookieFlow.authorizationUrl));
      const grant = IssuedPubkyAuthRequest.issue(encodeURIComponent(grantFlow.authorizationUrl));

      expect(Result.isOk(cookie) && cookie.value.review.authenticationMethod).toBe("cookie");
      expect(Result.isOk(grant) && grant.value.review.authenticationMethod).toBe("grant");
      expect(Result.isOk(grant) && grant.value.review.callbackHost).toBeUndefined();
    } finally {
      cookieFlow.free();
      grantFlow.free();
      relyingParty.free();
    }
  });

  it("keeps the capability path bound aligned with the SDK", () => {
    const atLimit = capabilityPath(PUBKY_AUTH_REQUEST_LIMITS.maximumCapabilityPathUtf8Bytes);
    const overLimit = capabilityPath(PUBKY_AUTH_REQUEST_LIMITS.maximumCapabilityPathUtf8Bytes + 1);

    expect(() => validateCapabilities(`${atLimit}:r`)).not.toThrow();
    expect(() => validateCapabilities(`${overLimit}:r`)).toThrow();

    const accepted = IssuedPubkyAuthRequest.issue(encodeURIComponent(
      authorizationRequest(atLimit),
    ));
    const rejected = IssuedPubkyAuthRequest.issue(encodeURIComponent(
      authorizationRequest(overLimit),
    ));
    expect(Result.isOk(accepted)).toBe(true);
    expect(Result.isError(rejected) && rejected.error).toEqual({ code: "invalid_capability" });
  });

  it("creates an opaque key handle and public identity", async () => {
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());

      expect(created.publicIdentity.publicKeyZ32).toMatch(/^[13456789abcdefghijkmnopqrstuwxyz]+$/);
    } finally {
      pubky.dispose();
    }
  });

  it("returns the exact SDK cause when key creation throws without logging its value", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = "SECRET-KEY-CREATION-VALUE";
    vi.spyOn(Keypair, "random").mockImplementation(() => {
      throw cause;
    });
    const pubky = new PubkySdkAdapter();

    try {
      expectErrorCause(await pubky.createIdentityKey(), "create_failed", cause);
      expect(warn).toHaveBeenCalledWith("identity.pubky.operation.failed", {
        operation: "create_identity_key",
        stage: "sdk_create",
        code: "create_failed",
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(cause);
    } finally {
      pubky.dispose();
    }
  });

  it("preserves public-identity failures without wrapping or logging them twice", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const thrownValue = new Error("SECRET-PUBLIC-KEY-MATERIAL");
    vi.spyOn(Keypair.prototype, "publicKey", "get").mockImplementation(() => {
      throw thrownValue;
    });
    const pubky = new PubkySdkAdapter();

    try {
      const result = await pubky.createIdentityKey();
      expect(Result.isError(result)).toBe(true);
      if (!Result.isError(result)) throw new Error("Expected public-identity failure.");
      expect(result.error.code).toBe("public_identity_failed");
      expect(result.error.cause).toBe(thrownValue);
      expect(warn).toHaveBeenCalledWith("identity.pubky.operation.failed", {
        operation: "create_identity_key",
        stage: "sdk_public_identity",
        code: "public_identity_failed",
      });
      expect(warn).toHaveBeenCalledOnce();
      expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-PUBLIC-KEY-MATERIAL");
    } finally {
      pubky.dispose();
    }
  });

  it("exports and restores 32-byte key material without retaining plaintext input", async () => {
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const exported = expectOk(await pubky.exportSecretKey(created.keyHandle));

      expect(exported.format).toBe(PUBKY_SECRET_KEY_FORMAT);
      expect(exported.bytes).toHaveLength(PUBKY_SECRET_KEY_BYTES);

      const restored = expectOk(await pubky.restoreIdentityKey(exported));

      expect(exported.bytes).toEqual(new Uint8Array(PUBKY_SECRET_KEY_BYTES));
      expect(restored.publicIdentity).toEqual(created.publicIdentity);
    } finally {
      pubky.dispose();
    }
  });

  it("creates an SDK recovery file and clears the plaintext key", async () => {
    const pubky = new PubkySdkAdapter();
    let restored: Keypair | undefined;

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const secretKey = expectOk(await pubky.exportSecretKey(created.keyHandle));
      const recoveryFile = expectOk(pubky.createRecoveryFile(secretKey, "a strong backup password"));
      restored = Keypair.fromRecoveryFile(recoveryFile, "a strong backup password");
      const restoredPublicKey = restored.publicKey;
      try {
        expect(restoredPublicKey.z32()).toBe(created.publicIdentity.publicKeyZ32);
        expect(secretKey.bytes).toEqual(new Uint8Array(PUBKY_SECRET_KEY_BYTES));
      } finally {
        restoredPublicKey.free();
        recoveryFile.fill(0);
      }
    } finally {
      restored?.free();
      pubky.dispose();
    }
  });

  it("returns the exact recovery-file SDK cause without logging the passphrase", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const secretKey = expectOk(await pubky.exportSecretKey(created.keyHandle));
      const cause = new RangeError("SECRET-RECOVERY-PASSPHRASE");
      vi.spyOn(Keypair.prototype, "createRecoveryFile").mockImplementation(() => {
        throw cause;
      });

      expectErrorCause(
        pubky.createRecoveryFile(secretKey, "SECRET-RECOVERY-PASSPHRASE"),
        "recovery_file_failed",
        cause,
      );
      expect(secretKey.bytes).toEqual(new Uint8Array(PUBKY_SECRET_KEY_BYTES));
      expect(warn).toHaveBeenCalledWith("identity.pubky.operation.failed", {
        operation: "create_recovery_file",
        stage: "sdk_recovery_file",
        code: "recovery_file_failed",
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-RECOVERY-PASSPHRASE");
    } finally {
      pubky.dispose();
    }
  });

  it("rejects and clears invalid key material before restoration", async () => {
    const pubky = new PubkySdkAdapter();
    const bytes = new Uint8Array(PUBKY_SECRET_KEY_BYTES - 1).fill(7);

    try {
      await expectError(
        pubky.restoreIdentityKey({ bytes, format: PUBKY_SECRET_KEY_FORMAT }),
        "invalid_secret_key",
      );
      expect(bytes).toEqual(new Uint8Array(PUBKY_SECRET_KEY_BYTES - 1));
    } finally {
      pubky.dispose();
    }
  });

  it("preserves an invalid-key result when clearing detached key material fails", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const pubky = new PubkySdkAdapter();
    const bytes = new Uint8Array(PUBKY_SECRET_KEY_BYTES).fill(7);
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });

    try {
      await expectError(
        pubky.restoreIdentityKey({ bytes, format: PUBKY_SECRET_KEY_FORMAT }),
        "invalid_secret_key",
      );
      expect(warn).toHaveBeenCalledWith("identity.pubky.cleanup.failed", {
        operation: "restore_identity_key",
        stage: "secret_key_clear",
        code: "cleanup_failed",
      });
    } finally {
      pubky.dispose();
    }
  });

  it("returns safe unavailable errors for unknown key handles", async () => {
    const pubky = new PubkySdkAdapter();
    const keyHandle = {} as PubkyIdentityKeyHandle;

    try {
      await expectError(pubky.exportSecretKey(keyHandle), "key_unavailable");
      await expectError(pubky.signup(keyHandle, "not used"), "key_unavailable");
      await expectError(pubky.publishHomeserver(keyHandle), "key_unavailable");
    } finally {
      pubky.dispose();
    }
  });

  it("rejects an invalid public identity before homeserver resolution", async () => {
    const pubky = new PubkySdkAdapter();
    try {
      await expectError(pubky.resolveHomeserver("not-a-pubky"), "invalid_pubky");
    } finally {
      pubky.dispose();
    }
  });

  it("returns the exact homeserver-resolution cause without logging SDK details", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new TypeError("SECRET-HOMESERVER-URL");
    vi.spyOn(Pubky.prototype, "getHomeserverOf").mockRejectedValue(cause);
    const pubky = new PubkySdkAdapter();

    try {
      const result = await pubky.resolveHomeserver("8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo");
      expectErrorCause(result, "resolution_failed", cause);
      expect(warn).toHaveBeenCalledWith("identity.pubky.operation.failed", {
        operation: "resolve_homeserver",
        stage: "sdk_resolution",
        code: "resolution_failed",
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-HOMESERVER-URL");
    } finally {
      pubky.dispose();
    }
  });

  it("maps invalid homeserver values without exposing signup codes", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const signup = await pubky.signup(created.keyHandle, "not a public key", "sensitive-signup-code");
      const publication = await pubky.publishHomeserver(created.keyHandle, "not a public key");

      expectErrorResult(signup, "invalid_homeserver_pubky");
      expectErrorResult(publication, "invalid_homeserver_pubky");
      expect(JSON.stringify(signup)).not.toContain("sensitive-signup-code");
      expect(warn).toHaveBeenCalledWith("identity.pubky.operation.failed", {
        operation: "signup",
        stage: "homeserver_parse",
        code: "invalid_homeserver_pubky",
      });
      expect(warn).toHaveBeenCalledWith("identity.pubky.operation.failed", {
        operation: "publish_homeserver",
        stage: "homeserver_parse",
        code: "invalid_homeserver_pubky",
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain("sensitive-signup-code");
    } finally {
      pubky.dispose();
    }
  });

  it("publishes stale PKDNS records through the SDK and logs only a safe PKARR error category", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const forcePublish = vi.spyOn(Pkdns.prototype, "publishHomeserverForce");
    const cause = Object.assign(new Error("sensitive PKARR transport details"), { name: "PkarrError" });
    const publishIfStale = vi.spyOn(Pkdns.prototype, "publishHomeserverIfStale")
      .mockImplementation(async (homeserver) => {
        homeserver?.free();
        throw cause;
      });
    const pubky = new PubkySdkAdapter();
    const homeserver = Keypair.random();
    const homeserverPublicKey = homeserver.publicKey;

    try {
      const identity = expectOk(await pubky.createIdentityKey());
      const result = await pubky.publishHomeserver(
        identity.keyHandle,
        homeserverPublicKey.z32(),
      );

      expectErrorCause(result, "publish_failed", cause);
      expect(publishIfStale).toHaveBeenCalledOnce();
      expect(forcePublish).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith("identity.pubky.operation.failed", {
        operation: "publish_homeserver",
        stage: "sdk_publish",
        code: "publish_failed",
        sdkErrorName: "PkarrError",
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain("sensitive PKARR transport details");
    } finally {
      homeserverPublicKey.free();
      homeserver.free();
      pubky.dispose();
    }
  });

  it("logs only the safe SDK error category when signup fails", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = Object.assign(
      new Error("signup token and request URL must stay private"),
      { name: "AuthenticationError" },
    );
    vi.spyOn(Signer.prototype, "signup").mockRejectedValue(cause);
    const pubky = new PubkySdkAdapter();
    const homeserver = Keypair.random();
    const homeserverPublicKey = homeserver.publicKey;

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const result = await pubky.signup(
        created.keyHandle,
        homeserverPublicKey.z32(),
        "sensitive-signup-code",
      );

      expectErrorCause(result, "signup_failed", cause);
      expect(warn).toHaveBeenCalledWith("identity.pubky.operation.failed", {
        operation: "signup",
        stage: "sdk_signup",
        code: "signup_failed",
        sdkErrorName: "AuthenticationError",
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain("sensitive-signup-code");
      expect(JSON.stringify(warn.mock.calls)).not.toContain("signup token and request URL");
    } finally {
      homeserverPublicKey.free();
      homeserver.free();
      pubky.dispose();
    }
  });

  it("returns an uninspectable SDK cause without reading or logging an arbitrary name", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new Proxy({}, {
      get() {
        throw new Error("SECRET-ERROR-NAME");
      },
      has() {
        throw new Error("SECRET-ERROR-NAME");
      },
    });
    vi.spyOn(Signer.prototype, "signup").mockRejectedValue(cause);
    const pubky = new PubkySdkAdapter();
    const homeserver = Keypair.random();
    const homeserverPublicKey = homeserver.publicKey;

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const result = await pubky.signup(
        created.keyHandle,
        homeserverPublicKey.z32(),
        "SECRET-SIGNUP-CODE",
      );

      expectErrorCause(result, "signup_uncertain", cause);
      expect(warn).toHaveBeenCalledWith("identity.pubky.operation.failed", {
        operation: "signup",
        stage: "sdk_signup",
        code: "signup_uncertain",
      });
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain("SECRET-ERROR-NAME");
      expect(logged).not.toContain("SECRET-SIGNUP-CODE");
    } finally {
      homeserverPublicKey.free();
      homeserver.free();
      pubky.dispose();
    }
  });

  it.each([
    [400, "signup_failed"],
    [401, "signup_failed"],
    [403, "signup_failed"],
    [408, "signup_uncertain"],
    [409, "account_exists"],
    [422, "signup_failed"],
    [425, "signup_uncertain"],
    [429, "signup_uncertain"],
    [500, "signup_uncertain"],
    [503, "signup_uncertain"],
  ] as const)("maps signup status %s to %s", async (statusCode, expectedCode) => {
    vi.spyOn(Signer.prototype, "signup").mockRejectedValue(Object.assign(
      new Error("sensitive signup failure"),
      { name: "RequestError", data: { statusCode } },
    ));
    const pubky = new PubkySdkAdapter();
    const homeserver = Keypair.random();
    const homeserverPublicKey = homeserver.publicKey;

    try {
      const created = expectOk(await pubky.createIdentityKey());
      await expectError(pubky.signup(
        created.keyHandle,
        homeserverPublicKey.z32(),
        "sensitive-signup-code",
      ), expectedCode);
    } finally {
      homeserverPublicKey.free();
      homeserver.free();
      pubky.dispose();
    }
  });

  it.each([
    ["InvalidInput", "signup_failed"],
    ["ClientStateError", "signup_failed"],
    ["PkarrError", "signup_uncertain"],
  ] as const)("maps signup SDK error %s to %s", async (name, expectedCode) => {
    vi.spyOn(Signer.prototype, "signup").mockRejectedValue(Object.assign(
      new Error("sensitive signup failure"),
      { name },
    ));
    const pubky = new PubkySdkAdapter();
    const homeserver = Keypair.random();
    const homeserverPublicKey = homeserver.publicKey;

    try {
      const created = expectOk(await pubky.createIdentityKey());
      await expectError(pubky.signup(
        created.keyHandle,
        homeserverPublicKey.z32(),
        "sensitive-signup-code",
      ), expectedCode);
    } finally {
      homeserverPublicKey.free();
      homeserver.free();
      pubky.dispose();
    }
  });

  it("does not treat an unscoped SDK 404 as proof that the account is missing", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    vi.spyOn(Signer.prototype, "signin").mockRejectedValue(Object.assign(
      new Error("sensitive homeserver response"),
      { name: "RequestError", data: { statusCode: 404 } },
    ));
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      await expectError(pubky.signin(created.keyHandle), "signin_failed");
      expect(JSON.stringify(warn.mock.calls)).not.toContain("sensitive homeserver response");
    } finally {
      pubky.dispose();
    }
  });

  it("does not block a successful signin on PKDNS publication", async () => {
    const signin = vi.spyOn(Signer.prototype, "signin");
    const signinBlocking = vi.spyOn(Signer.prototype, "signinBlocking");
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const session = {
        get info() {
          return {
            publicKey: PublicKey.from(created.publicIdentity.publicKeyZ32),
            free: vi.fn(),
          };
        },
        signout: vi.fn().mockResolvedValue(undefined),
        free: vi.fn(),
      } as unknown as Session;
      signin.mockResolvedValue(session);
      const result = expectOk(await pubky.signin(created.keyHandle));

      expect(result.publicIdentity).toEqual(created.publicIdentity);
      expect(signin).toHaveBeenCalledWith("passport.pubky.app");
      expect(signinBlocking).not.toHaveBeenCalled();
    } finally {
      pubky.dispose();
    }
  });

  it("can wait for PKDNS publication when activating an identity", async () => {
    const signin = vi.spyOn(Signer.prototype, "signin");
    const signinBlocking = vi.spyOn(Signer.prototype, "signinBlocking").mockRejectedValue(Object.assign(
      new Error("sensitive PKARR transport details"),
      { name: "PkarrError" },
    ));
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      await expectError(pubky.signin(created.keyHandle, {
        waitForPkdnsPublication: true,
      }), "signin_failed");

      expect(signinBlocking).toHaveBeenCalledWith("passport.pubky.app");
      expect(signin).not.toHaveBeenCalled();
    } finally {
      pubky.dispose();
    }
  });

  it("rejects auth requests not issued by the parser before SDK approval", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const pubky = new PubkySdkAdapter();

    try {
      const forgedRequests = [
        Object.create(IssuedPubkyAuthRequest.prototype) as IssuedPubkyAuthRequest,
        {
          isLive: () => true,
          validatedUrlForApproval: () => "pubkyauth://signin?secret=forged",
        } as unknown as IssuedPubkyAuthRequest,
      ];
      for (const forgedRequest of forgedRequests) {
        const result = await pubky.approveAuthRequest(
          {} as PubkyIdentityKeyHandle,
          forgedRequest,
        );
        expectErrorResult(result, "request_rejected");
      }

      expect(warn).toHaveBeenCalledWith("identity.pubky.operation.failed", {
        operation: "approve_auth_request",
        stage: "request_validation",
        code: "request_rejected",
      });
    } finally {
      pubky.dispose();
    }
  });

  it("returns the exact approval cause without logging the authorization URL", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new Error("SECRET-AUTHORIZATION-URL");
    vi.spyOn(Signer.prototype, "approveAuthRequest").mockRejectedValue(cause);
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const request = expectOk(IssuedPubkyAuthRequest.issue(encodeURIComponent(
        authorizationRequest("/pub/passport.test"),
      )));
      const result = await pubky.approveAuthRequest(created.keyHandle, request);

      expectErrorCause(result, "approval_failed", cause);
      expect(warn).toHaveBeenCalledWith("identity.pubky.operation.failed", {
        operation: "approve_auth_request",
        stage: "sdk_approval",
        code: "approval_failed",
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-AUTHORIZATION-URL");
    } finally {
      pubky.dispose();
    }
  });

  it("disposes keypairs and rejects old handles", async () => {
    const pubky = new PubkySdkAdapter();
    const created = expectOk(await pubky.createIdentityKey());

    pubky.dispose();
    pubky.dispose();

    await expectError(pubky.exportSecretKey(created.keyHandle), "key_unavailable");
    await expectError(pubky.createIdentityKey(), "key_unavailable");
  });

  it("invalidates handles before freeing and continues after cleanup failures", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const pubky = new PubkySdkAdapter();
    const individuallyDisposed = expectOk(await pubky.createIdentityKey());
    const firstBulkHandle = expectOk(await pubky.createIdentityKey()).keyHandle;
    const secondBulkHandle = expectOk(await pubky.createIdentityKey()).keyHandle;
    const free = vi.spyOn(Keypair.prototype, "free");

    free.mockImplementationOnce(() => { throw new Error("SECRET-KEY-CANARY"); });
    expect(() => pubky.disposeIdentityKey(individuallyDisposed.keyHandle)).not.toThrow();
    await expectError(pubky.exportSecretKey(individuallyDisposed.keyHandle), "key_unavailable");

    free.mockImplementationOnce(() => { throw new Error("free failed"); });
    expect(() => pubky.dispose()).not.toThrow();
    expect(free).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith("identity.pubky.cleanup.failed", {
      operation: "dispose_identity_key",
      stage: "keypair_free",
      code: "cleanup_failed",
    });
    expect(warn).toHaveBeenCalledWith("identity.pubky.cleanup.failed", {
      operation: "dispose_adapter",
      stage: "keypair_free",
      code: "cleanup_failed",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-KEY-CANARY");
    await expectError(pubky.exportSecretKey(firstBulkHandle), "key_unavailable");
    await expectError(pubky.exportSecretKey(secondBulkHandle), "key_unavailable");
  });
});

function authorizationRequest(capabilityPath: string): string {
  return `pubkyauth://signin?caps=${capabilityPath}:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8`;
}

function capabilityPath(length: number): string {
  const segments: string[] = [];
  let remaining = length - 1;
  while (remaining > 0) {
    const segmentLength = Math.min(255, remaining);
    segments.push("a".repeat(segmentLength));
    remaining -= segmentLength;
    if (remaining > 0) remaining -= 1;
  }
  return `/${segments.join("/")}`;
}

async function expectError<Success>(result: Promise<ResultType<Success, { code: string }>>, code: string): Promise<void> {
  expectErrorResult(await result, code);
}

function expectErrorResult(result: ResultType<unknown, { code: string }>, code: string): void {
  expect(Result.isError(result)).toBe(true);
  if (Result.isError(result)) {
    expect(result.error.code).toBe(code);
  }
}

function expectErrorCause(
  result: ResultType<unknown, { code: string; cause?: unknown }>,
  code: string,
  cause: unknown,
): void {
  expect(Result.isError(result)).toBe(true);
  if (!Result.isError(result)) return;
  expect(result.error.code).toBe(code);
  expect(result.error.cause).toBe(cause);
}

function expectOk<Success>(result: ResultType<Success, unknown>): Success {
  expect(Result.isOk(result)).toBe(true);
  if (Result.isError(result)) {
    throw result.error;
  }

  return result.value;
}
