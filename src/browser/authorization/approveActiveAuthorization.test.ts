import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { parsePubkyAuthRequest } from "../../features/auth/parsePubkyAuthRequest";
import type { PubkyIdentityKey } from "../../features/identity/pubkyIdentity";
import type {
  LocalIdentityRepository,
  LocalIdentityRepositoryResult,
} from "../identity/localIdentityRepository";
import { FakePubkyAuthApproval } from "../../../test-utils/fakes/fakePubkyAuthApproval";
import { FakePubkyIdentityKeys } from "../../../test-utils/fakes/fakePubkyIdentityKeys";
import { approveActiveAuthorization } from "./approveActiveAuthorization";

const request = "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=sensitive";

describe("approveActiveAuthorization", () => {
  it("restores, approves with the same Pubky instance, and disposes the key", async () => {
    const keys = new FakePubkyIdentityKeys();
    const approval = new FakePubkyAuthApproval();
    const pubky = Object.assign(keys, { approveAuthRequest: approval.approveAuthRequest.bind(approval) });
    const restored = keys.createKey();
    const localIdentities = new FakeLocalIdentities(Result.ok(restored));
    const parsed = parsePubkyAuthRequest(encodeURIComponent(request), { allowedRelayOrigins: ["https://relay.example"] });
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    const result = await approveActiveAuthorization({ authRequest: parsed.value.approval, localIdentities, pubky });

    expect(Result.isOk(result)).toBe(true);
    expect(localIdentities.identityKeys).toBe(pubky);
    expect(approval.calls).toEqual([{ keyHandle: restored.keyHandle, authRequestScheme: "pubkyauth:" }]);
    expect(keys.disposedKeys).toEqual([restored.keyHandle]);
  });

  it("returns a safe missing-identity error without approving", async () => {
    const keys = new FakePubkyIdentityKeys();
    const approval = new FakePubkyAuthApproval();
    const pubky = Object.assign(keys, { approveAuthRequest: approval.approveAuthRequest.bind(approval) });
    const localIdentities = new FakeLocalIdentities(Result.err({ code: "no_active_identity" }));
    const parsed = parsePubkyAuthRequest(encodeURIComponent(request), { allowedRelayOrigins: ["https://relay.example"] });
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
    const parsed = parsePubkyAuthRequest(encodeURIComponent(request), { allowedRelayOrigins: ["https://relay.example"] });
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    const result = await approveActiveAuthorization({ authRequest: parsed.value.approval, localIdentities, pubky });

    expect(Result.isError(result) && result.error).toEqual({ code: "approval_failed" });
    expect(keys.disposedKeys).toEqual([restored.keyHandle]);
  });
});

class FakeLocalIdentities implements LocalIdentityRepository {
  identityKeys: unknown;

  constructor(private readonly restored: LocalIdentityRepositoryResult<PubkyIdentityKey>) {}

  list() { return Result.ok({ activeIdentityId: null, identities: [] }); }
  async saveIdentity() { return Result.err({ code: "storage_unavailable" as const }); }
  select() { return Result.ok(); }
  clear() { return Result.ok(); }
  async restoreActiveIdentity(input: Parameters<LocalIdentityRepository["restoreActiveIdentity"]>[0]) {
    this.identityKeys = input.identityKeys;
    return this.restored;
  }
}
