/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  BrowserPubky: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("../pubky/browserPubky", () => ({
  BrowserPubky: mocks.BrowserPubky,
}));

import { createBrowserAuthorizationController } from "./createBrowserAuthorizationController";

const relayOrigin = "https://relay.example";

describe("createBrowserAuthorizationController", () => {
  beforeEach(() => {
    mocks.BrowserPubky.mockReset();
    mocks.dispose.mockReset();
    mocks.BrowserPubky.mockImplementation(function () {
      return { dispose: mocks.dispose };
    });
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("constructs Pubky lazily for approval and owns adapter cleanup", async () => {
    window.history.replaceState({}, "", `/authorize?d=${encodeURIComponent(validRequest())}`);

    const controller = createBrowserAuthorizationController({ relayOrigin });

    expect(controller.getState().status).toBe("review");
    expect(mocks.BrowserPubky).not.toHaveBeenCalled();

    await expect(controller.approve()).resolves.toEqual({
      status: "failed",
      failureCode: "no_active_identity",
    });
    expect(mocks.BrowserPubky).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("maps identity repository failures at the authorization composition boundary", async () => {
    localStorage.setItem("pubky-passport/local-identities/v1", "invalid-store");
    window.history.replaceState({}, "", `/authorize?d=${encodeURIComponent(validRequest())}`);
    const controller = createBrowserAuthorizationController({ relayOrigin });

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
