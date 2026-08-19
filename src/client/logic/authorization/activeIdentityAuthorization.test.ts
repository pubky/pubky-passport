import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../../libs/logger/logger";
import { RecordingPubkySdkAdapter } from "../../../../test-utils/fakes/RecordingPubkySdkAdapter";
import {
  ActiveIdentityAuthorization,
  restoreActiveLocalIdentity,
} from "./ActiveIdentityAuthorization";
import { IssuedPubkyAuthRequest } from "./IssuedPubkyAuthRequest";

const REQUEST = "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

describe("ActiveIdentityAuthorization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores, approves with the same Pubky instance, and disposes the key", async () => {
    const pubky = new RecordingPubkySdkAdapter();
    const restored = await createIdentity(pubky);
    const result = await new ActiveIdentityAuthorization(
      () => pubky,
      restorer(Result.ok(restored)),
    ).approve(request());

    expect(Result.isOk(result)).toBe(true);
    expect(pubky.approvalCalls).toEqual([{ scheme: "pubkyauth:", queryKeys: ["caps", "relay", "secret"] }]);
    expect(pubky.disposedKeys).toEqual([restored.keyHandle]);
  });

  it("returns a safe missing-identity error without approving", async () => {
    const pubky = new RecordingPubkySdkAdapter();
    const restoreActiveIdentity = restorer(Result.err({ code: "no_active_identity" }));

    const result = await new ActiveIdentityAuthorization(
      () => pubky,
      restoreActiveIdentity,
    ).approve(request());

    expect(Result.isError(result) && result.error).toEqual({ code: "no_active_identity" });
    expect(pubky.approvalCalls).toEqual([]);
    expect(pubky.disposedKeys).toEqual([]);
  });

  it("disposes the restored key when approval fails", async () => {
    const pubky = new RecordingPubkySdkAdapter();
    pubky.approvalFailure = "relay_failed";
    const restored = await createIdentity(pubky);

    const result = await new ActiveIdentityAuthorization(
      () => pubky,
      restorer(Result.ok(restored)),
    ).approve(request());

    expect(Result.isError(result) && result.error).toEqual({ code: "approval_failed" });
    expect(pubky.disposedKeys).toEqual([restored.keyHandle]);
  });

  it("maps unexpected restore and approval exceptions without exposing details", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const restorePubky = new RecordingPubkySdkAdapter();
    const failedRestore = restorer(Result.err({ code: "no_active_identity" }));
    failedRestore.mockRejectedValueOnce(new Error("sensitive restore details"));

    const restoreFailure = await new ActiveIdentityAuthorization(
      () => restorePubky,
      failedRestore,
    ).approve(request());
    expect(Result.isError(restoreFailure) && restoreFailure.error).toEqual({ code: "identity_restore_failed" });

    const approvalPubky = new RecordingPubkySdkAdapter();
    const restored = await createIdentity(approvalPubky);
    vi.spyOn(approvalPubky, "approveAuthRequest").mockRejectedValueOnce(new Error("sensitive approval details"));
    const approvalFailure = await new ActiveIdentityAuthorization(
      () => approvalPubky,
      restorer(Result.ok(restored)),
    ).approve(request());
    expect(Result.isError(approvalFailure) && approvalFailure.error).toEqual({ code: "approval_failed" });

    expect(warning).toHaveBeenCalledWith("authorize.approval.failed", {
      stage: "identity_restore",
      code: "unexpected_failure",
    });
    expect(warning).toHaveBeenCalledWith("authorize.approval.failed", {
      stage: "sdk_approve",
      code: "unexpected_failure",
    });
    expect(approvalPubky.disposedKeys).toEqual([restored.keyHandle]);
  });

  it("logs cleanup failures without changing the approval result", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const pubky = new RecordingPubkySdkAdapter();
    const restored = await createIdentity(pubky);
    pubky.throwOnDisposeIdentity = true;

    const result = await new ActiveIdentityAuthorization(
      () => pubky,
      restorer(Result.ok(restored)),
    ).approve(request());

    expect(Result.isOk(result)).toBe(true);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("authorize.cleanup.failed", {
      operation: "identity_key_dispose",
    });
  });
});

function request(): IssuedPubkyAuthRequest {
  const issued = IssuedPubkyAuthRequest.issue(encodeURIComponent(REQUEST));
  if (Result.isError(issued)) throw new Error(issued.error.code);
  return issued.value;
}

async function createIdentity(pubky: RecordingPubkySdkAdapter) {
  const created = await pubky.createIdentityKey();
  if (Result.isError(created)) throw new Error(created.error.code);
  return created.value;
}

function restorer(
  result: Awaited<ReturnType<typeof restoreActiveLocalIdentity>>,
) {
  return vi.fn(async () => result);
}
