/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../test-utils/fakes/memoryStorage";

const MOCKS = vi.hoisted(() => ({
  PubkySdkAdapter: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("../pubky/adapters/pubkySdkAdapter", () => ({
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
      return { dispose: MOCKS.dispose };
    });
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => vi.unstubAllGlobals());

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
});

function validRequest(): string {
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(`${RELAY_ORIGIN}/inbox`)}&secret=sensitive-secret`;
}
