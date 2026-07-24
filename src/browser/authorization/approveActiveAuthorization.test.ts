import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { parsePubkyAuthRequest } from "../../core/auth/parsePubkyAuthRequest";
import {
  approveActiveAuthorization,
  type ActiveAuthorizationIdentityRestorer,
  type ActiveAuthorizationIdentityRestoreResult,
} from "./approveActiveAuthorization";
import { FakePubkyAuthApproval } from "../../../test-utils/fakes/fakePubkyAuthApproval";
import { FakePubkyIdentityKeys } from "../../../test-utils/fakes/fakePubkyIdentityKeys";

const request = "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=sensitive";

describe("approveActiveAuthorization", () => {
  it("restores, approves with the same Pubky instance, and disposes the key", async () => {
    const keys = new FakePubkyIdentityKeys();
    const approval = new FakePubkyAuthApproval();
    const pubky = Object.assign(keys, { approveAuthRequest: approval.approveAuthRequest.bind(approval) });
    const restored = keys.createKey();
    const localIdentities = new FakeLocalIdentities(Result.ok(restored));
    const parsed = parsePubkyAuthRequest(encodeURIComponent(request));
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    const result = await approveActiveAuthorization({ authRequest: parsed.value.approval, localIdentities, pubky });

    expect(Result.isOk(result)).toBe(true);
    expect(approval.calls).toEqual([{ keyHandle: restored.keyHandle, authRequestScheme: "pubkyauth:" }]);
    expect(keys.disposedKeys).toEqual([restored.keyHandle]);
  });

  it("returns a safe missing-identity error without approving", async () => {
    const keys = new FakePubkyIdentityKeys();
    const approval = new FakePubkyAuthApproval();
    const pubky = Object.assign(keys, { approveAuthRequest: approval.approveAuthRequest.bind(approval) });
    const localIdentities = new FakeLocalIdentities(Result.err({ code: "no_active_identity" }));
    const parsed = parsePubkyAuthRequest(encodeURIComponent(request));
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    const result = await approveActiveAuthorization({ authRequest: parsed.value.approval, localIdentities, pubky });

    expect(Result.isError(result) && result.error).toEqual({ code: "no_active_identity" });
    expect(approval.calls).toEqual([]);
    expect(keys.disposedKeys).toEqual([]);
  });

  it("disposes the restored key when approval fails", async () => {
    const keys = new FakePubkyIdentityKeys();
    const approval = new FakePubkyAuthApproval();
    approval.approvalFailure = "relay_failed";
    const pubky = Object.assign(keys, { approveAuthRequest: approval.approveAuthRequest.bind(approval) });
    const restored = keys.createKey();
    const localIdentities = new FakeLocalIdentities(Result.ok(restored));
    const parsed = parsePubkyAuthRequest(encodeURIComponent(request));
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    const result = await approveActiveAuthorization({ authRequest: parsed.value.approval, localIdentities, pubky });

    expect(Result.isError(result) && result.error).toEqual({ code: "approval_failed" });
    expect(keys.disposedKeys).toEqual([restored.keyHandle]);
  });
});

class FakeLocalIdentities implements ActiveAuthorizationIdentityRestorer {
  constructor(private readonly restored: ActiveAuthorizationIdentityRestoreResult) {}

  async restoreActiveIdentity() {
    return this.restored;
  }
}
