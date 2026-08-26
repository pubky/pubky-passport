/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../../../test-utils/MemoryStorage";
import { LOGGER } from "../../../../libs/logger/logger";
import { LocalStorageIdentityRepository } from "../../local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityMetadata } from "../../local-identity/localIdentityModels";
import {
  PUBKY_SECRET_KEY_FORMAT,
  type PubkySecretKeyMaterial,
} from "../../pubky/pubkyIdentityKey";

const MOCKS = vi.hoisted(() => ({
  PubkySdkAdapter: vi.fn(),
  dispose: vi.fn(),
  restoreIdentityKey: vi.fn(),
  disposeIdentityKey: vi.fn(),
  approveAuthRequest: vi.fn(),
}));

vi.mock("../../pubky/PubkySdkAdapter", () => ({
  PubkySdkAdapter: MOCKS.PubkySdkAdapter,
}));

import { PassportAuthorizationController } from "./PassportAuthorizationController";

const RELAY_ORIGIN = "https://relay.example";

describe("PassportAuthorizationController composition", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    MOCKS.PubkySdkAdapter.mockReset();
    MOCKS.dispose.mockReset();
    MOCKS.restoreIdentityKey.mockReset();
    MOCKS.disposeIdentityKey.mockReset();
    MOCKS.approveAuthRequest.mockReset();
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
    window.history.replaceState({}, "", `/authorize#d=${encodeURIComponent(validRequest())}`);

    const controller = PassportAuthorizationController.fromBrowser();

    expect(controller.getState().status).toBe("review");
    expect(MOCKS.PubkySdkAdapter).not.toHaveBeenCalled();

    await expect(controller.approve("missing-public-key")).resolves.toEqual({
      status: "failed",
    });
    expect(MOCKS.PubkySdkAdapter).toHaveBeenCalledOnce();
    expect(MOCKS.dispose).toHaveBeenCalledOnce();
  });

  it("maps identity repository failures at the authorization composition boundary", async () => {
    window.localStorage.setItem("pubky-passport/local-identities/v1", "invalid-store");
    window.history.replaceState({}, "", `/authorize#d=${encodeURIComponent(validRequest())}`);
    const controller = PassportAuthorizationController.fromBrowser();

    await expect(controller.approve("missing-public-key")).resolves.toEqual({
      status: "failed",
    });
    expect(MOCKS.dispose).toHaveBeenCalledOnce();
  });

  it("logs SDK construction failures without exposing the authorization request", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.PubkySdkAdapter.mockImplementationOnce(function () {
      throw new Error("sensitive authorization request");
    });
    window.history.replaceState({}, "", `/authorize#d=${encodeURIComponent(validRequest())}`);
    const controller = PassportAuthorizationController.fromBrowser();

    await expect(controller.approve("missing-public-key")).resolves.toEqual({
      status: "failed",
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("authorize.approval.failed", {
      stage: "sdk_initialize",
      code: "unexpected_failure",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("sensitive authorization request");
  });

  it("logs adapter cleanup failures without changing the authorization result", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    MOCKS.dispose.mockImplementationOnce(() => {
      throw new Error("cleanup failed");
    });
    window.history.replaceState({}, "", `/authorize#d=${encodeURIComponent(validRequest())}`);
    const controller = PassportAuthorizationController.fromBrowser();

    await expect(controller.approve("missing-public-key")).resolves.toEqual({
      status: "failed",
    });
    expect(info).toHaveBeenCalledWith("identity.local_store.failed", {
      operation: "read_identity",
      code: "invalid_identity",
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("authorize.cleanup.failed", {
      operation: "pubky_dispose",
    });
  });

  it("approves with the reviewed identity after another identity becomes active", async () => {
    const firstIdentity = identity("5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo");
    const secondIdentity = identity("y".repeat(52));
    const repository = new LocalStorageIdentityRepository();
    expect(Result.isOk(repository.save(firstIdentity, secretKey(1)))).toBe(true);
    expect(Result.isOk(repository.save(secondIdentity, secretKey(2)))).toBe(true);
    let restoredSecretByte: number | undefined;
    MOCKS.restoreIdentityKey.mockImplementation(async (secretKey) => {
      restoredSecretByte = secretKey.bytes[0];
      secretKey.bytes.fill(0);
      return Result.ok({ keyHandle: {}, publicIdentity: firstIdentity.publicIdentity });
    });
    MOCKS.approveAuthRequest.mockResolvedValue(Result.ok());
    window.history.replaceState({}, "", `/authorize#d=${encodeURIComponent(validRequest())}`);
    const controller = PassportAuthorizationController.fromBrowser();

    await expect(controller.approve(firstIdentity.publicIdentity.publicKeyZ32)).resolves.toEqual({
      status: "approved",
    });

    expect(restoredSecretByte).toBe(1);
    expect(MOCKS.approveAuthRequest).toHaveBeenCalledOnce();
  });
});

function validRequest(): string {
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(`${RELAY_ORIGIN}/inbox`)}&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8`;
}

function identity(publicKeyZ32: string): LocalIdentityMetadata {
  return {
    publicIdentity: {
      publicKeyZ32,
    },
  };
}

function secretKey(value: number): PubkySecretKeyMaterial {
  return {
    bytes: new Uint8Array(32).fill(value),
    format: PUBKY_SECRET_KEY_FORMAT,
  };
}
