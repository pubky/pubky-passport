import {
  AuthFlowKind,
  Keypair,
  Pkdns,
  Pubky,
  Signer,
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
      expect(created.publicIdentity.publicKeyDisplay).toBe(`pubky${created.publicIdentity.publicKeyZ32}`);
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
      await expectError(pubky.signup({ keyHandle, homeserverPubky: "not used" }), "key_unavailable");
      await expectError(pubky.publishHomeserver({ keyHandle }), "key_unavailable");
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

  it("maps invalid homeserver values without exposing signup codes", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const pubky = new PubkySdkAdapter();

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const signup = await pubky.signup({ keyHandle: created.keyHandle, homeserverPubky: "not a public key", signupCode: "sensitive-signup-code" });
      const publication = await pubky.publishHomeserver({ keyHandle: created.keyHandle, homeserverPubky: "not a public key" });

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
    const publishIfStale = vi.spyOn(Pkdns.prototype, "publishHomeserverIfStale")
      .mockImplementation(async (homeserver) => {
        homeserver?.free();
        throw Object.assign(new Error("sensitive PKARR transport details"), { name: "PkarrError" });
      });
    const pubky = new PubkySdkAdapter();
    const homeserver = Keypair.random();
    const homeserverPublicKey = homeserver.publicKey;

    try {
      const identity = expectOk(await pubky.createIdentityKey());
      const result = await pubky.publishHomeserver({
        keyHandle: identity.keyHandle,
        homeserverPubky: homeserverPublicKey.z32(),
      });

      expectErrorResult(result, "publish_failed");
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
    vi.spyOn(Signer.prototype, "signup").mockRejectedValue(Object.assign(
      new Error("signup token and request URL must stay private"),
      { name: "AuthenticationError" },
    ));
    const pubky = new PubkySdkAdapter();
    const homeserver = Keypair.random();
    const homeserverPublicKey = homeserver.publicKey;

    try {
      const created = expectOk(await pubky.createIdentityKey());
      const result = await pubky.signup({
        keyHandle: created.keyHandle,
        homeserverPubky: homeserverPublicKey.z32(),
        signupCode: "sensitive-signup-code",
      });

      expectErrorResult(result, "signup_failed");
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
      await expectError(pubky.signup({
        keyHandle: created.keyHandle,
        homeserverPubky: homeserverPublicKey.z32(),
        signupCode: "sensitive-signup-code",
      }), expectedCode);
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
      await expectError(pubky.signup({
        keyHandle: created.keyHandle,
        homeserverPubky: homeserverPublicKey.z32(),
        signupCode: "sensitive-signup-code",
      }), expectedCode);
    } finally {
      homeserverPublicKey.free();
      homeserver.free();
      pubky.dispose();
    }
  });

  it("does not treat an unscoped SDK 404 as proof that the account is missing", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    vi.spyOn(Signer.prototype, "signinBlocking").mockRejectedValue(Object.assign(
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
    expect(result.error).toEqual({ code });
  }
}

function expectOk<Success>(result: ResultType<Success, unknown>): Success {
  expect(Result.isOk(result)).toBe(true);
  if (Result.isError(result)) {
    throw result.error;
  }

  return result.value;
}
