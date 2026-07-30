/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../test-utils/fakes/memoryStorage";
import { LOGGER } from "../../libs/logger/logger";

const MOCKS = vi.hoisted(() => ({
  PubkySdkAdapter: vi.fn(),
  dispose: vi.fn(),
  restoreIdentityKey: vi.fn(),
  disposeIdentityKey: vi.fn(),
  approveAuthRequest: vi.fn(),
}));

vi.mock("../pubky/pubkySdkAdapter", () => ({
  PubkySdkAdapter: MOCKS.PubkySdkAdapter,
}));

import { createBrowserAuthorizationController } from "./createBrowserAuthorizationController";

const RELAY_ORIGIN = "https://relay.example";

describe("createBrowserAuthorizationController", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    MOCKS.PubkySdkAdapter.mockReset();
    MOCKS.dispose.mockReset();
    MOCKS.PubkySdkAdapter.mockImplementation(function () {
      return {
        dispose: MOCKS.dispose,
        restoreIdentityKey: MOCKS.restoreIdentityKey,
        disposeIdentityKey: MOCKS.disposeIdentityKey,
        approveAuthRequest: MOCKS.approveAuthRequest,
      };
    });
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("constructs Pubky lazily for approval and owns adapter cleanup", async () => {
    window.history.replaceState({}, "", `/authorize?d=${encodeURIComponent(validRequest())}`);

    const controller = createBrowserAuthorizationController();

    expect(controller.getState().status).toBe("review");
    expect(MOCKS.PubkySdkAdapter).not.toHaveBeenCalled();

    await expect(controller.approve()).resolves.toEqual({
      status: "failed",
      failureCode: "no_active_identity",
    });
    expect(MOCKS.PubkySdkAdapter).toHaveBeenCalledOnce();
    expect(MOCKS.dispose).toHaveBeenCalledOnce();
  });

  it("maps identity repository failures at the authorization composition boundary", async () => {
    window.localStorage.setItem("pubky-passport/local-identities/v1", "invalid-store");
    window.history.replaceState({}, "", `/authorize?d=${encodeURIComponent(validRequest())}`);
    const controller = createBrowserAuthorizationController();

    await expect(controller.approve()).resolves.toEqual({
      status: "failed",
      failureCode: "identity_restore_failed",
    });
    expect(MOCKS.dispose).toHaveBeenCalledOnce();
  });

  it("logs SDK construction failures without exposing the authorization request", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.PubkySdkAdapter.mockImplementationOnce(function () {
      throw new Error("sensitive authorization request");
    });
    window.history.replaceState({}, "", `/authorize?d=${encodeURIComponent(validRequest())}`);
    const controller = createBrowserAuthorizationController();

    await expect(controller.approve()).resolves.toEqual({
      status: "failed",
      failureCode: "approval_failed",
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("authorize.approval.failed", {
      stage: "sdk_initialize",
      code: "unexpected_failure",
    });
  });

  it("logs adapter cleanup failures without changing the authorization result", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.dispose.mockImplementationOnce(() => {
      throw new Error("cleanup failed");
    });
    window.history.replaceState({}, "", `/authorize?d=${encodeURIComponent(validRequest())}`);
    const controller = createBrowserAuthorizationController();

    await expect(controller.approve()).resolves.toEqual({
      status: "failed",
      failureCode: "no_active_identity",
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("authorize.cleanup.failed", {
      operation: "pubky_dispose",
    });
  });
});

function validRequest(): string {
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(`${RELAY_ORIGIN}/inbox`)}&secret=sensitive-secret`;
}
