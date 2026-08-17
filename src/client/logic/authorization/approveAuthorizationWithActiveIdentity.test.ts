import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../../libs/logger/logger";
import { RestoreActiveLocalIdentityKey } from "../identity/local/restoreActiveLocalIdentityKey";
import { RecordingPubkySdkAdapter } from "../../../../test-utils/fakes/recordingPubkySdkAdapter";
import { approveAuthorizationWithActiveIdentity } from "./approveAuthorizationWithActiveIdentity";
import { parseBrowserAuthorizationRequest } from "./browserAuthorizationRequest";

const REQUEST = "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

describe("approveAuthorizationWithActiveIdentity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores, approves with the same Pubky instance, and disposes the key", async () => {
    const pubky = new RecordingPubkySdkAdapter();
    const restored = await createIdentity(pubky);
    const result = await approveAuthorizationWithActiveIdentity(
      approval(),
      restorer(pubky, Result.ok(restored)),
      pubky,
    );

    expect(Result.isOk(result)).toBe(true);
    expect(pubky.approvalCalls).toEqual([{ scheme: "pubkyauth:", queryKeys: ["caps", "relay", "secret"] }]);
    expect(pubky.disposedKeys).toEqual([restored.keyHandle]);
  });

  it("returns a safe missing-identity error without approving", async () => {
    const pubky = new RecordingPubkySdkAdapter();
    const restoreActiveIdentity = restorer(pubky, Result.err({ code: "no_active_identity" }));

    const result = await approveAuthorizationWithActiveIdentity(
      approval(),
      restoreActiveIdentity,
      pubky,
    );

    expect(Result.isError(result) && result.error).toEqual({ code: "no_active_identity" });
    expect(pubky.approvalCalls).toEqual([]);
    expect(pubky.disposedKeys).toEqual([]);
  });

  it("disposes the restored key when approval fails", async () => {
    const pubky = new RecordingPubkySdkAdapter();
    pubky.approvalFailure = "relay_failed";
    const restored = await createIdentity(pubky);

    const result = await approveAuthorizationWithActiveIdentity(
      approval(),
      restorer(pubky, Result.ok(restored)),
      pubky,
    );

    expect(Result.isError(result) && result.error).toEqual({ code: "approval_failed" });
    expect(pubky.disposedKeys).toEqual([restored.keyHandle]);
  });

  it("maps unexpected restore and approval exceptions without exposing details", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const pubky = new RecordingPubkySdkAdapter();
    const failedRestore = restorer(pubky, Result.err({ code: "no_active_identity" }));
    vi.mocked(failedRestore.restore).mockRejectedValueOnce(new Error("sensitive restore details"));

    const restoreFailure = await approveAuthorizationWithActiveIdentity(
      approval(),
      failedRestore,
      pubky,
    );
    expect(Result.isError(restoreFailure) && restoreFailure.error).toEqual({ code: "identity_restore_failed" });

    const restored = await createIdentity(pubky);
    vi.spyOn(pubky, "approveAuthRequest").mockRejectedValueOnce(new Error("sensitive approval details"));
    const approvalFailure = await approveAuthorizationWithActiveIdentity(
      approval(),
      restorer(pubky, Result.ok(restored)),
      pubky,
    );
    expect(Result.isError(approvalFailure) && approvalFailure.error).toEqual({ code: "approval_failed" });

    expect(warning).toHaveBeenCalledWith("authorize.approval.failed", {
      stage: "identity_restore",
      code: "unexpected_failure",
    });
    expect(warning).toHaveBeenCalledWith("authorize.approval.failed", {
      stage: "sdk_approve",
      code: "unexpected_failure",
    });
    expect(pubky.disposedKeys).toEqual([restored.keyHandle]);
  });

  it("logs cleanup failures without changing the approval result", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const pubky = new RecordingPubkySdkAdapter();
    const restored = await createIdentity(pubky);
    pubky.throwOnDisposeIdentity = true;

    const result = await approveAuthorizationWithActiveIdentity(
      approval(),
      restorer(pubky, Result.ok(restored)),
      pubky,
    );

    expect(Result.isOk(result)).toBe(true);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("authorize.cleanup.failed", {
      operation: "identity_key_dispose",
    });
  });
});

function approval() {
  const parsed = parseBrowserAuthorizationRequest(encodeURIComponent(REQUEST));
  if (Result.isError(parsed)) throw new Error(parsed.error.code);
  return parsed.value.approval;
}

async function createIdentity(pubky: RecordingPubkySdkAdapter) {
  const created = await pubky.createIdentityKey();
  if (Result.isError(created)) throw new Error(created.error.code);
  return created.value;
}

function restorer(
  pubky: RecordingPubkySdkAdapter,
  result: Awaited<ReturnType<RestoreActiveLocalIdentityKey["restore"]>>,
): RestoreActiveLocalIdentityKey {
  const restoreActiveIdentity = new RestoreActiveLocalIdentityKey(
    () => Result.err({ code: "no_active_identity" }),
    pubky,
  );
  vi.spyOn(restoreActiveIdentity, "restore").mockResolvedValue(result);
  return restoreActiveIdentity;
}
