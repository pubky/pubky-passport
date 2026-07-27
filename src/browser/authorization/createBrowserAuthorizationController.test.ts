/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../test-utils/fakes/memoryStorage";

const mocks = vi.hoisted(() => ({
  PubkySdkAdapter: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("../pubky/adapters/pubkySdkAdapter", () => ({
  PubkySdkAdapter: mocks.PubkySdkAdapter,
}));

import { createBrowserAuthorizationController } from "./createBrowserAuthorizationController";

const relayOrigin = "https://relay.example";

describe("createBrowserAuthorizationController", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    mocks.PubkySdkAdapter.mockReset();
    mocks.dispose.mockReset();
    mocks.PubkySdkAdapter.mockImplementation(function () {
      return { dispose: mocks.dispose };
    });
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("constructs Pubky lazily for approval and owns adapter cleanup", async () => {
    window.history.replaceState({}, "", `/authorize?d=${encodeURIComponent(validRequest())}`);

    const controller = createBrowserAuthorizationController();

    expect(controller.getState().status).toBe("review");
    expect(mocks.PubkySdkAdapter).not.toHaveBeenCalled();

    await expect(controller.approve()).resolves.toEqual({
      status: "failed",
      failureCode: "no_active_identity",
    });
    expect(mocks.PubkySdkAdapter).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("maps identity repository failures at the authorization composition boundary", async () => {
    window.localStorage.setItem("pubky-passport/local-identities/v1", "invalid-store");
    window.history.replaceState({}, "", `/authorize?d=${encodeURIComponent(validRequest())}`);
    const controller = createBrowserAuthorizationController();

    await expect(controller.approve()).resolves.toEqual({
      status: "failed",
      failureCode: "identity_restore_failed",
    });
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});

function validRequest(): string {
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(`${relayOrigin}/inbox`)}&secret=sensitive-secret`;
}
