import { describe, expect, it } from "vitest";
import { Result, type Result as ResultType } from "better-result";

import { parseBrowserAuthorizationRequest } from "../../src/client/browser/authorization/browserAuthorizationRequest";
import { PUBKY_SECRET_KEY_FORMAT } from "../../src/client/browser/pubky/pubkyIdentityKey";
import { RecordingPubkySdkAdapter } from "./recordingPubkySdkAdapter";

describe("Pubky identity test doubles", () => {
  it("creates, restores, exports, and returns deterministic public identity data", async () => {
    const keys = new RecordingPubkySdkAdapter();
    const created = expectOk(await keys.createIdentityKey());
    const publicIdentity = expectOk(await keys.getPublicIdentity(created.keyHandle));
    const secretKey = expectOk(await keys.exportSecretKey(created.keyHandle));
    const restored = expectOk(await keys.restoreIdentityKey(secretKey));

    expect(created.publicIdentity).toEqual(keys.nextPublicIdentity);
    expect(publicIdentity).toEqual(keys.nextPublicIdentity);
    expect(restored.publicIdentity).toEqual(keys.nextPublicIdentity);
    expect(secretKey.format).toBe(keys.secretKey.format);
    expect(keys.createCalls).toBe(1);
    expect(keys.exportCalls).toBe(1);
    expect(keys.restoreCalls).toEqual([
      {
        secretKeyByteLength: keys.secretKey.bytes.byteLength,
        secretKeyFormat: PUBKY_SECRET_KEY_FORMAT,
      },
    ]);
  });

  it("simulates expected key operation failures", async () => {
    const keys = new RecordingPubkySdkAdapter();
    const created = expectOk(await keys.createIdentityKey());

    keys.createFailure = "create_failed";
    keys.restoreFailure = "restore_failed";
    keys.exportFailure = "export_failed";
    keys.publicIdentityFailure = "public_identity_failed";

    await expectError(keys.createIdentityKey(), "create_failed");
    await expectError(
      keys.restoreIdentityKey(keys.secretKey),
      "restore_failed",
    );
    await expectError(
      keys.exportSecretKey(created.keyHandle),
      "export_failed",
    );
    await expectError(keys.getPublicIdentity(created.keyHandle), "public_identity_failed");
  });

  it("simulates signup and signin without recording raw signup codes", async () => {
    const sessionAccess = new RecordingPubkySdkAdapter();
    const key = expectOk(await sessionAccess.createIdentityKey());
    const signupResult = expectOk(
      await sessionAccess.signup({
        keyHandle: key.keyHandle,
        homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
        signupCode: "SECRET-SIGNUP-CODE",
      }),
    );
    const signinResult = expectOk(await sessionAccess.signin(key.keyHandle));

    expect(signupResult).toEqual(sessionAccess.session);
    expect(signinResult).toEqual(sessionAccess.session);
    expect(sessionAccess.signupCalls).toEqual([
      {
        homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
        hasSignupCode: true,
      },
    ]);
    expect(sessionAccess.signinCalls).toBe(1);
    expect(JSON.stringify(sessionAccess.signupCalls)).not.toContain("SECRET-SIGNUP-CODE");

    sessionAccess.signupFailure = "signup_failed";
    sessionAccess.signinFailure = "signin_failed";

    await expectError(sessionAccess.signup({ keyHandle: key.keyHandle, homeserverPubky: "invalid" }), "signup_failed");
    await expectError(sessionAccess.signin(key.keyHandle), "signin_failed");
  });

  it("simulates discovery publication success and failure", async () => {
    const discovery = new RecordingPubkySdkAdapter();
    const key = expectOk(await discovery.createIdentityKey());

    await expectOk(
      discovery.publishHomeserverIfStale({
        keyHandle: key.keyHandle,
        homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
      }),
    );
    expect(discovery.discoveryCalls).toEqual([{ hasHomeserverPubky: true }]);

    discovery.discoveryFailure = "publish_failed";

    await expectDiscoveryError(discovery.publishHomeserverIfStale({ keyHandle: key.keyHandle }), "publish_failed");
  });

  it("simulates auth approval without recording raw pubkyauth URLs", async () => {
    const authApproval = new RecordingPubkySdkAdapter();
    const key = expectOk(await authApproval.createIdentityKey());
    const parsedAuthRequest = parseBrowserAuthorizationRequest(encodeURIComponent(
      "pubkyauth://signin?secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&relay=https://httprelay.pubky.app/inbox&caps=/pub/pubky.app/:rw",
    ));
    const authRequest = expectOk(parsedAuthRequest).approval;

    await expectOk(authApproval.approveAuthRequest(key.keyHandle, authRequest));

    expect(authApproval.approvalCalls).toEqual([{
      scheme: "pubkyauth:",
      queryKeys: ["caps", "relay", "secret"],
    }]);
    expect(JSON.stringify(authApproval.approvalCalls)).not.toContain("SECRET-AUTH-REQUEST");

    authApproval.approvalFailure = "relay_failed";

    await expectAuthApprovalError(
      authApproval.approveAuthRequest(key.keyHandle, authRequest),
      "relay_failed",
    );
  });
});

function expectOk<Success>(result: Promise<ResultType<Success, unknown>>): Promise<Success>;
function expectOk<Success>(result: ResultType<Success, unknown>): Success;
function expectOk<Success>(
  result:
    | Promise<ResultType<Success, unknown>>
    | ResultType<Success, unknown>,
): Success | Promise<Success> {
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
