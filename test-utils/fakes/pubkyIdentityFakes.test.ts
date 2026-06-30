import { describe, expect, it } from "vitest";

import type { PubkyIdentityKey } from "@/core/domain/identity/pubkyIdentity";
import { FakePubkyAuthApproval } from "./fakePubkyAuthApproval";
import { FakePubkyDiscovery } from "./fakePubkyDiscovery";
import { FakePubkyIdentityKeys } from "./fakePubkyIdentityKeys";
import { FakePubkySignup } from "./fakePubkySignup";

describe("Pubky identity fakes", () => {
  it("creates, restores, exports, and returns deterministic public identity data", async () => {
    const keys = new FakePubkyIdentityKeys();
    const created = expectOk(await keys.createIdentityKey());
    const publicIdentity = expectOk(await keys.getPublicIdentity({ keyHandle: created.keyHandle }));
    const recoveryFile = expectOk(
      await keys.exportRecoveryFile({ keyHandle: created.keyHandle, recoveryPassphrase: "derived-passphrase" }),
    );
    const restored = expectOk(
      await keys.restoreIdentityKey({ recoveryFile, recoveryPassphrase: "derived-passphrase" }),
    );

    expect(created.publicIdentity).toEqual(keys.nextPublicIdentity);
    expect(publicIdentity).toEqual(keys.nextPublicIdentity);
    expect(restored.publicIdentity).toEqual(keys.nextPublicIdentity);
    expect(recoveryFile).toEqual(keys.recoveryFile);
    expect(keys.createCalls).toBe(1);
    expect(keys.exportCalls).toEqual([{ keyHandle: created.keyHandle, hasRecoveryPassphrase: true }]);
    expect(keys.restoreCalls).toEqual([
      {
        recoveryFileByteLength: keys.recoveryFile.bytes.byteLength,
        recoveryFileFormat: "pubky-recovery-file",
        hasRecoveryPassphrase: true,
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
      keys.restoreIdentityKey({ recoveryFile: keys.recoveryFile, recoveryPassphrase: "derived-passphrase" }),
      "restore_failed",
    );
    await expectError(
      keys.exportRecoveryFile({ keyHandle: created.keyHandle, recoveryPassphrase: "derived-passphrase" }),
      "export_failed",
    );
    await expectError(keys.getPublicIdentity({ keyHandle: created.keyHandle }), "public_identity_failed");
  });

  it("simulates signup and signin without recording raw signup codes", async () => {
    const key = await fakeKey();
    const signup = new FakePubkySignup();
    const signupResult = expectOk(
      await signup.signup({
        keyHandle: key.keyHandle,
        homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
        signupCode: "SECRET-SIGNUP-CODE",
      }),
    );
    const signinResult = expectOk(await signup.signin({ keyHandle: key.keyHandle, waitForDiscovery: true }));

    expect(signupResult).toEqual(signup.session);
    expect(signinResult).toEqual(signup.session);
    expect(signup.signupCalls).toEqual([
      {
        keyHandle: key.keyHandle,
        homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
        hasSignupCode: true,
      },
    ]);
    expect(signup.signinCalls).toEqual([{ keyHandle: key.keyHandle, waitForDiscovery: true }]);
    expect(JSON.stringify(signup.signupCalls)).not.toContain("SECRET-SIGNUP-CODE");

    signup.signupFailure = "signup_failed";
    signup.signinFailure = "signin_failed";

    await expectError(signup.signup({ keyHandle: key.keyHandle, homeserverPubky: "invalid" }), "signup_failed");
    await expectError(signup.signin({ keyHandle: key.keyHandle }), "signin_failed");
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
    await expectOk(discovery.publishHomeserverForce({ keyHandle: key.keyHandle, homeserverPubky: null }));

    expect(discovery.calls).toEqual([
      {
        keyHandle: key.keyHandle,
        mode: "if_stale",
        homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
      },
      { keyHandle: key.keyHandle, mode: "force", homeserverPubky: null },
    ]);

    discovery.ifStaleFailure = "publish_failed";
    discovery.forceFailure = "key_unavailable";

    await expectDiscoveryError(discovery.publishHomeserverIfStale({ keyHandle: key.keyHandle }), "publish_failed");
    await expectDiscoveryError(discovery.publishHomeserverForce({ keyHandle: key.keyHandle }), "key_unavailable");
  });

  it("simulates auth approval without recording raw pubkyauth URLs", async () => {
    const key = await fakeKey();
    const authApproval = new FakePubkyAuthApproval();
    const authRequest = {
      sensitivePubkyAuthUrl:
        "pubkyauth://signin?secret=SECRET-AUTH-REQUEST&relay=https://httprelay.pubky.app/inbox&caps=/pub/pubky.app/:rw",
    };

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

function expectOk<T>(result: Promise<{ ok: true; value?: T } | { ok: false; error: unknown }>): Promise<T>;
function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T;
function expectOk<T>(
  result:
    | Promise<{ ok: true; value?: T } | { ok: false; error: unknown }>
    | { ok: true; value: T }
    | { ok: false; error: unknown },
): T | Promise<T> {
  if (result instanceof Promise) {
    return result.then((resolved) => {
      expect(resolved.ok).toBe(true);
      return (resolved as { ok: true; value?: T }).value as T;
    });
  }

  expect(result.ok).toBe(true);
  return (result as { ok: true; value: T }).value;
}

async function expectError(
  result: Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string } }>,
  code: string,
): Promise<void> {
  expect(await result).toEqual({ ok: false, error: { code } });
}

async function expectDiscoveryError(
  result: Promise<{ ok: true } | { ok: false; error: { code: string } }>,
  code: string,
): Promise<void> {
  expect(await result).toEqual({ ok: false, error: { code } });
}

async function expectAuthApprovalError(
  result: Promise<{ ok: true } | { ok: false; error: { code: string } }>,
  code: string,
): Promise<void> {
  expect(await result).toEqual({ ok: false, error: { code } });
}
