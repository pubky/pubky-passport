/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../../../libs/logger/logger";
import { IssuedPubkyAuthRequest } from "../request/IssuedPubkyAuthRequest";

const MOCKS = vi.hoisted(() => ({
  approveAuthRequest: vi.fn(),
  dispose: vi.fn(),
  disposeIdentityKey: vi.fn(),
  PubkySdkAdapter: vi.fn(),
  readIdentity: vi.fn(),
  restoreIdentityKey: vi.fn(),
}));

vi.mock("../../pubky/PubkySdkAdapter", () => ({
  PubkySdkAdapter: MOCKS.PubkySdkAdapter,
}));

vi.mock("../../local-identity/LocalStorageIdentityRepository", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../local-identity/LocalStorageIdentityRepository")>(),
  LocalStorageIdentityRepository: class {
    read = MOCKS.readIdentity;
  },
}));

import { approveAuthorization } from "./approveAuthorization";

const SELECTED_IDENTITY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const PUBLIC_IDENTITY = {
  publicKeyZ32: SELECTED_IDENTITY,
};
const OTHER_PUBLIC_IDENTITY = {
  publicKeyZ32: "y".repeat(52),
};
const KEY_HANDLE = {};
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

describe("approveAuthorization", () => {
  let secretKey: { bytes: Uint8Array; format: string };

  beforeEach(() => {
    for (const mock of Object.values(MOCKS)) mock.mockReset();
    secretKey = { bytes: new Uint8Array(32).fill(7), format: "pubky-secret-key" };
    MOCKS.PubkySdkAdapter.mockImplementation(function () {
      return {
        approveAuthRequest: MOCKS.approveAuthRequest,
        dispose: MOCKS.dispose,
        disposeIdentityKey: MOCKS.disposeIdentityKey,
        restoreIdentityKey: MOCKS.restoreIdentityKey,
      };
    });
    MOCKS.readIdentity.mockReturnValue(Result.ok({
      identity: { publicIdentity: PUBLIC_IDENTITY },
      secretKey,
    }));
    MOCKS.restoreIdentityKey.mockResolvedValue(Result.ok({
      keyHandle: KEY_HANDLE,
      publicIdentity: PUBLIC_IDENTITY,
    }));
    MOCKS.approveAuthRequest.mockResolvedValue(Result.ok());
  });

  afterEach(() => vi.restoreAllMocks());

  it("approves with the selected identity and disposes key resources", async () => {
    const request = issuedRequest();

    const result = await approveAuthorization(request, SELECTED_IDENTITY);

    expect(Result.isOk(result)).toBe(true);
    expect(MOCKS.readIdentity).toHaveBeenCalledWith(SELECTED_IDENTITY);
    expect(MOCKS.restoreIdentityKey).toHaveBeenCalledWith(secretKey);
    expect(MOCKS.approveAuthRequest).toHaveBeenCalledWith(KEY_HANDLE, request);
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
    expect(MOCKS.dispose).toHaveBeenCalledOnce();
    expect(secretKey.bytes).toEqual(new Uint8Array(32));
  });

  it("rejects stored metadata for a different identity before restoration", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.readIdentity.mockReturnValue(Result.ok({
      identity: { publicIdentity: OTHER_PUBLIC_IDENTITY },
      secretKey,
    }));

    const result = await approveAuthorization(issuedRequest(), SELECTED_IDENTITY);

    expect(Result.isError(result)).toBe(true);
    if (Result.isOk(result)) throw new Error("Expected approval to fail");
    expect(result.error).toEqual({
      code: "approval_failed",
      cause: { code: "identity_mismatch" },
    });
    expect(result.error.cause).not.toHaveProperty("cause");
    expect(MOCKS.restoreIdentityKey).not.toHaveBeenCalled();
    expect(secretKey.bytes).toEqual(new Uint8Array(32));
  });

  it("disposes a restored key that does not match stored identity metadata", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.restoreIdentityKey.mockResolvedValueOnce(Result.ok({
      keyHandle: KEY_HANDLE,
      publicIdentity: OTHER_PUBLIC_IDENTITY,
    }));

    const result = await approveAuthorization(issuedRequest(), SELECTED_IDENTITY);

    expect(Result.isError(result)).toBe(true);
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
    expect(MOCKS.approveAuthRequest).not.toHaveBeenCalled();
  });

  it("contains SDK exceptions and still disposes resources", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const approvalError = new Error(`approval exploded ${SECRET}`);
    MOCKS.approveAuthRequest.mockRejectedValueOnce(approvalError);

    const result = await approveAuthorization(issuedRequest(), SELECTED_IDENTITY);

    expect(Result.isError(result)).toBe(true);
    if (Result.isOk(result)) throw new Error("Expected approval to fail");
    expect(result.error.cause).toBe(approvalError);
    expect(warning).toHaveBeenCalledWith("authorize.approval.failed", {
      stage: "sdk_approve",
      code: "unexpected_failure",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(SECRET);
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
    expect(MOCKS.dispose).toHaveBeenCalledOnce();
  });

  it("preserves the entire lower approval error as the cause", async () => {
    const sdkCause = new Error(`lower SDK failure ${SECRET}`);
    const lowerError = { code: "relay_failed" as const, cause: sdkCause };
    MOCKS.approveAuthRequest.mockResolvedValueOnce(Result.err(lowerError));

    const result = await approveAuthorization(issuedRequest(), SELECTED_IDENTITY);

    if (Result.isOk(result)) throw new Error("Expected approval to fail");
    expect(result.error).toEqual({ code: "approval_failed", cause: lowerError });
    expect(result.error.cause).toBe(lowerError);
  });

  it("preserves nested restoration failures without flattening their cause", async () => {
    const sdkCause = new Error(`restore SDK failure ${SECRET}`);
    const lowerError = { code: "restore_failed" as const, cause: sdkCause };
    MOCKS.restoreIdentityKey.mockResolvedValueOnce(Result.err(lowerError));

    const result = await approveAuthorization(issuedRequest(), SELECTED_IDENTITY);

    if (Result.isOk(result)) throw new Error("Expected approval to fail");
    expect(result.error.code).toBe("approval_failed");
    expect(result.error.cause).toEqual({
      code: "restore_failed",
      cause: lowerError,
    });
    expect((result.error.cause as { cause?: unknown }).cause).toBe(lowerError);
  });

  it("allows identity restoration to take as long as the user needs", async () => {
    let continueRestoration: () => void = () => undefined;
    const restorationGate = new Promise<void>((resolve) => {
      continueRestoration = resolve;
    });
    MOCKS.restoreIdentityKey.mockImplementationOnce(async () => {
      await restorationGate;
      return Result.ok({ keyHandle: KEY_HANDLE, publicIdentity: PUBLIC_IDENTITY });
    });
    const approval = approveAuthorization(issuedRequest(), SELECTED_IDENTITY);
    await vi.waitFor(() => expect(MOCKS.restoreIdentityKey).toHaveBeenCalledOnce());

    continueRestoration();

    expect(Result.isOk(await approval)).toBe(true);
    expect(MOCKS.approveAuthRequest).toHaveBeenCalledWith(KEY_HANDLE, expect.anything());
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
  });
});

function issuedRequest(): IssuedPubkyAuthRequest {
  const issued = IssuedPubkyAuthRequest.issue(encodeURIComponent(
    `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=${SECRET}`,
  ));
  if (Result.isError(issued)) throw new Error(issued.error.code);
  return issued.value;
}
