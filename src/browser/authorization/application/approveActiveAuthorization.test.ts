import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { parsePubkyAuthRequest } from "../../../core/auth/parsePubkyAuthRequest";
import {
  approveActiveAuthorization,
} from "./approveActiveAuthorization";
import { RecordingPubkySdkAdapter } from "../../../../test-utils/fakes/recordingPubkySdkAdapter";

const REQUEST = "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=sensitive";

describe("approveActiveAuthorization", () => {
  it("restores, approves with the same Pubky instance, and disposes the key", async () => {
    const pubky = new RecordingPubkySdkAdapter();
    const restoredResult = await pubky.createIdentityKey();
    if (Result.isError(restoredResult)) throw new Error(restoredResult.error.code);
    const restored = restoredResult.value;
    const restoreActiveIdentity = vi.fn(async () => Result.ok(restored));
    const parsed = parsePubkyAuthRequest(encodeURIComponent(REQUEST));
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    const result = await approveActiveAuthorization({
      authRequest: parsed.value.approval,
      restoreActiveIdentity,
      pubky,
    });

    expect(Result.isOk(result)).toBe(true);
    expect(pubky.approvalCalls).toEqual([{ scheme: "pubkyauth:", queryKeys: ["caps", "relay", "secret"] }]);
    expect(pubky.disposedKeys).toEqual([restored.keyHandle]);
  });

  it("returns a safe missing-identity error without approving", async () => {
    const pubky = new RecordingPubkySdkAdapter();
    const restoreActiveIdentity = vi.fn(async () => Result.err({ code: "no_active_identity" as const }));
    const parsed = parsePubkyAuthRequest(encodeURIComponent(REQUEST));
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    const result = await approveActiveAuthorization({
      authRequest: parsed.value.approval,
      restoreActiveIdentity,
      pubky,
    });

    expect(Result.isError(result) && result.error).toEqual({ code: "no_active_identity" });
    expect(pubky.approvalCalls).toEqual([]);
    expect(pubky.disposedKeys).toEqual([]);
  });

  it("disposes the restored key when approval fails", async () => {
    const pubky = new RecordingPubkySdkAdapter();
    pubky.approvalFailure = "relay_failed";
    const restoredResult = await pubky.createIdentityKey();
    if (Result.isError(restoredResult)) throw new Error(restoredResult.error.code);
    const restored = restoredResult.value;
    const restoreActiveIdentity = vi.fn(async () => Result.ok(restored));
    const parsed = parsePubkyAuthRequest(encodeURIComponent(REQUEST));
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    const result = await approveActiveAuthorization({
      authRequest: parsed.value.approval,
      restoreActiveIdentity,
      pubky,
    });

    expect(Result.isError(result) && result.error).toEqual({ code: "approval_failed" });
    expect(pubky.disposedKeys).toEqual([restored.keyHandle]);
  });
});
