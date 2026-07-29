import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { parsePubkyAuthRequest } from "../../../core/auth/parsePubkyAuthRequest";
import {
  approveActiveAuthorization,
} from "./approveActiveAuthorization";
import { SanitizedPubkyAuthApproval } from "../../../../test-utils/fakes/sanitizedPubkyAuthApproval";
import { RecordingPubkyIdentityKeys } from "../../../../test-utils/fakes/recordingPubkyIdentityKeys";

const REQUEST = "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=sensitive";

describe("approveActiveAuthorization", () => {
  it("restores, approves with the same Pubky instance, and disposes the key", async () => {
    const keys = new RecordingPubkyIdentityKeys();
    const approval = new SanitizedPubkyAuthApproval();
    const pubky = Object.assign(keys, { approveAuthRequest: approval.approveAuthRequest.bind(approval) });
    const restored = keys.createKey();
    const restoreActiveIdentity = vi.fn(async () => Result.ok(restored));
    const parsed = parsePubkyAuthRequest(encodeURIComponent(REQUEST));
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    const result = await approveActiveAuthorization({ authRequest: parsed.value.approval, restoreActiveIdentity, pubky });

    expect(Result.isOk(result)).toBe(true);
    expect(approval.calls).toEqual([{ keyHandle: restored.keyHandle, authRequestScheme: "pubkyauth:" }]);
    expect(keys.disposedKeys).toEqual([restored.keyHandle]);
  });

  it("returns a safe missing-identity error without approving", async () => {
    const keys = new RecordingPubkyIdentityKeys();
    const approval = new SanitizedPubkyAuthApproval();
    const pubky = Object.assign(keys, { approveAuthRequest: approval.approveAuthRequest.bind(approval) });
    const restoreActiveIdentity = vi.fn(async () => Result.err({ code: "no_active_identity" as const }));
    const parsed = parsePubkyAuthRequest(encodeURIComponent(REQUEST));
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    const result = await approveActiveAuthorization({ authRequest: parsed.value.approval, restoreActiveIdentity, pubky });

    expect(Result.isError(result) && result.error).toEqual({ code: "no_active_identity" });
    expect(approval.calls).toEqual([]);
    expect(keys.disposedKeys).toEqual([]);
  });

  it("disposes the restored key when approval fails", async () => {
    const keys = new RecordingPubkyIdentityKeys();
    const approval = new SanitizedPubkyAuthApproval();
    approval.approvalFailure = "relay_failed";
    const pubky = Object.assign(keys, { approveAuthRequest: approval.approveAuthRequest.bind(approval) });
    const restored = keys.createKey();
    const restoreActiveIdentity = vi.fn(async () => Result.ok(restored));
    const parsed = parsePubkyAuthRequest(encodeURIComponent(REQUEST));
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    const result = await approveActiveAuthorization({ authRequest: parsed.value.approval, restoreActiveIdentity, pubky });

    expect(Result.isError(result) && result.error).toEqual({ code: "approval_failed" });
    expect(keys.disposedKeys).toEqual([restored.keyHandle]);
  });
});
