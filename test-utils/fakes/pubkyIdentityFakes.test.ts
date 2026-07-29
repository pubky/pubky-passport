import { describe, expect, it } from "vitest";
import { Result, type Result as ResultType } from "better-result";

import { parsePubkyAuthRequest } from "../../src/core/auth/parsePubkyAuthRequest";
import { PUBKY_SECRET_KEY_FORMAT, type PubkyIdentityKey } from "../../src/browser/pubky/application/pubkyIdentityKeys";
import { FakePubkyAuthApproval } from "./fakePubkyAuthApproval";
import { FakePubkyDiscovery } from "./fakePubkyDiscovery";
import { FakePubkyIdentityKeys } from "./fakePubkyIdentityKeys";
import { FakePubkySessionAccess } from "./fakePubkySessionAccess";

describe("Pubky identity fakes", () => {
  it("creates, restores, exports, and returns deterministic public identity data", async () => {
    const keys = new FakePubkyIdentityKeys();
    const created = expectOk(await keys.createIdentityKey());
    const publicIdentity = expectOk(await keys.getPublicIdentity({ keyHandle: created.keyHandle }));
    const secretKey = expectOk(await keys.exportSecretKey({ keyHandle: created.keyHandle }));
    const restored = expectOk(await keys.restoreIdentityKey({ secretKey }));

    expect(created.publicIdentity).toEqual(keys.nextPublicIdentity);
    expect(publicIdentity).toEqual(keys.nextPublicIdentity);
    expect(restored.publicIdentity).toEqual(keys.nextPublicIdentity);
    expect(secretKey).toEqual(keys.secretKey);
    expect(keys.createCalls).toBe(1);
    expect(keys.exportCalls).toEqual([{ keyHandle: created.keyHandle }]);
    expect(keys.restoreCalls).toEqual([
      {
        secretKeyByteLength: keys.secretKey.bytes.byteLength,
        secretKeyFormat: PUBKY_SECRET_KEY_FORMAT,
      },
    ]);
  });

  it("simulates expected key operation failures", async () => {
    const keys = new FakePubkyIdentityKeys();
    const created = expectOk(await keys.createIdentityKey());

    keys.createFailure = "create_failed";
    keys.restoreFailure = "restore_failed";
    keys.exportFailure = "export_failed";
    keys.publicIdentityFailure = "public_identity_failed";

    await expectError(keys.createIdentityKey(), "create_failed");
    await expectError(
      keys.restoreIdentityKey({ secretKey: keys.secretKey }),
      "restore_failed",
    );
    await expectError(
      keys.exportSecretKey({ keyHandle: created.keyHandle }),
      "export_failed",
    );
    await expectError(keys.getPublicIdentity({ keyHandle: created.keyHandle }), "public_identity_failed");
  });

  it("simulates signup and signin without recording raw signup codes", async () => {
    const key = await fakeKey();
    const sessionAccess = new FakePubkySessionAccess();
    const signupResult = expectOk(
      await sessionAccess.signup({
        keyHandle: key.keyHandle,
        homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
        signupCode: "SECRET-SIGNUP-CODE",
      }),
    );
    const signinResult = expectOk(await sessionAccess.signin({ keyHandle: key.keyHandle, waitForDiscovery: true }));

    expect(signupResult).toEqual(sessionAccess.session);
    expect(signinResult).toEqual(sessionAccess.session);
    expect(sessionAccess.signupCalls).toEqual([
      {
        keyHandle: key.keyHandle,
        homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
        hasSignupCode: true,
      },
    ]);
    expect(sessionAccess.signinCalls).toEqual([{ keyHandle: key.keyHandle, waitForDiscovery: true }]);
    expect(JSON.stringify(sessionAccess.signupCalls)).not.toContain("SECRET-SIGNUP-CODE");

    sessionAccess.signupFailure = "signup_failed";
    sessionAccess.signinFailure = "signin_failed";

    await expectError(sessionAccess.signup({ keyHandle: key.keyHandle, homeserverPubky: "invalid" }), "signup_failed");
    await expectError(sessionAccess.signin({ keyHandle: key.keyHandle }), "signin_failed");
  });

  it("simulates discovery publication success and failure", async () => {
    const key = await fakeKey();
    const discovery = new FakePubkyDiscovery();

    await expectOk(
      discovery.publishHomeserverIfStale({
        keyHandle: key.keyHandle,
        homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
      }),
    );
    expect(discovery.calls).toEqual([
      {
        keyHandle: key.keyHandle,
        homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
      },
    ]);

    discovery.ifStaleFailure = "publish_failed";

    await expectDiscoveryError(discovery.publishHomeserverIfStale({ keyHandle: key.keyHandle }), "publish_failed");
  });

  it("simulates auth approval without recording raw pubkyauth URLs", async () => {
    const key = await fakeKey();
    const authApproval = new FakePubkyAuthApproval();
    const parsedAuthRequest = parsePubkyAuthRequest(encodeURIComponent(
      "pubkyauth://signin?secret=SECRET-AUTH-REQUEST&relay=https://httprelay.pubky.app/inbox&caps=/pub/pubky.app/:rw",
    ));
    const authRequest = expectOk(parsedAuthRequest).approval;

    await expectOk(authApproval.approveAuthRequest({ keyHandle: key.keyHandle, authRequest }));

    expect(authApproval.calls).toEqual([{ keyHandle: key.keyHandle, authRequestScheme: "pubkyauth:" }]);
    expect(JSON.stringify(authApproval.calls)).not.toContain("SECRET-AUTH-REQUEST");

    authApproval.approvalFailure = "relay_failed";

    await expectAuthApprovalError(
      authApproval.approveAuthRequest({ keyHandle: key.keyHandle, authRequest }),
      "relay_failed",
    );
  });
});

async function fakeKey(): Promise<PubkyIdentityKey> {
  return expectOk(await new FakePubkyIdentityKeys().createIdentityKey());
}

function expectOk<T>(result: Promise<ResultType<T, unknown>>): Promise<T>;
function expectOk<T>(result: ResultType<T, unknown>): T;
function expectOk<T>(
  result:
    | Promise<ResultType<T, unknown>>
    | ResultType<T, unknown>,
): T | Promise<T> {
  if (result instanceof Promise) {
    return result.then((resolved) => {
      expect(Result.isOk(resolved)).toBe(true);
      if (Result.isError(resolved)) {
        throw resolved.error;
      }

      return resolved.value;
    });
  }

  expect(Result.isOk(result)).toBe(true);
  if (Result.isError(result)) {
    throw result.error;
  }

  return result.value;
}

async function expectError(
  result: Promise<ResultType<unknown, { code: string }>>,
  code: string,
): Promise<void> {
  const resolved = await result;
  expect(Result.isError(resolved)).toBe(true);
  if (Result.isError(resolved)) {
    expect(resolved.error).toEqual({ code });
  }
}

async function expectDiscoveryError(
  result: Promise<ResultType<void, { code: string }>>,
  code: string,
): Promise<void> {
  return expectError(result, code);
}

async function expectAuthApprovalError(
  result: Promise<ResultType<void, { code: string }>>,
  code: string,
): Promise<void> {
  return expectError(result, code);
}
