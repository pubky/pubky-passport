/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../../test-utils/fakes/MemoryStorage";
import { LOGGER } from "../../../libs/logger/logger";
import { GoogleImplicitAuthorization } from "../google-authorization/GoogleImplicitAuthorization";
import { PUBKY_SECRET_KEY_FORMAT } from "../pubky/pubkyIdentityKey";
import { LocalStorageIdentityRepository } from "./local/LocalStorageIdentityRepository";

const MOCKS = vi.hoisted(() => ({
  GoogleBackedIdentityFlow: vi.fn(),
  start: vi.fn(),
}));

vi.mock("./google-backed/GoogleBackedIdentityFlow", () => ({
  GoogleBackedIdentityFlow: MOCKS.GoogleBackedIdentityFlow,
}));

import { PassportIdentityController } from "./PassportIdentityController";

const GOOGLE_CLIENT_ID = "google-client-id";
const HOMEGATE_BASE_URL = "https://homegate.example/";

describe("PassportIdentityController", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    MOCKS.GoogleBackedIdentityFlow.mockReset();
    MOCKS.start.mockReset();
    MOCKS.GoogleBackedIdentityFlow.mockImplementation(function () {
      return { start: MOCKS.start };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists local identities without constructing a Google flow", () => {
    const controller = createController();

    expect(controller.listIdentities()).toEqual(Result.ok({
      activeIdentityId: null,
      identities: [],
    }));
    expect(MOCKS.GoogleBackedIdentityFlow).not.toHaveBeenCalled();
  });

  it("starts an isolated Google flow with the shared local repository", () => {
    const controller = createController();
    const onState = vi.fn();

    const flow = controller.startGoogleIdentityFlow(onState);

    expect(flow).toBe(MOCKS.GoogleBackedIdentityFlow.mock.results[0]?.value);
    expect(MOCKS.GoogleBackedIdentityFlow).toHaveBeenCalledWith(
      expect.any(LocalStorageIdentityRepository),
      expect.any(GoogleImplicitAuthorization),
      HOMEGATE_BASE_URL,
      window.location.origin,
      onState,
    );
    expect(MOCKS.start).toHaveBeenCalledOnce();
  });

  it("creates a Ring migration URL and clears the returned secret bytes", () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => index);
    vi.spyOn(LocalStorageIdentityRepository.prototype, "readActive").mockReturnValue(Result.ok({
      identity: {
        id: "active",
        publicIdentity: { publicKeyZ32: "active", publicKeyDisplay: "pubkyactive" },
      },
      secretKey: { bytes, format: PUBKY_SECRET_KEY_FORMAT },
    }));
    const controller = createController();

    expect(controller.createPubkyRingMigrationUrl()).toEqual(Result.ok(
      "pubkyring://migrate?index=0&total=1&key=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    ));
    expect(bytes).toEqual(new Uint8Array(32));
  });

  it("preserves a migration read failure", () => {
    const controller = createController();

    const migration = controller.createPubkyRingMigrationUrl();

    expect(Result.isError(migration)).toBe(true);
    if (Result.isError(migration)) {
      expect(migration.error).toEqual({ code: "no_active_identity" });
    }
  });

  it("logs Google flow construction failures without sensitive configuration", () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    MOCKS.GoogleBackedIdentityFlow.mockImplementationOnce(() => {
      throw new Error("SECRET-CONFIGURATION-VALUE");
    });
    const controller = createController();

    expect(() => controller.startGoogleIdentityFlow(vi.fn())).toThrow(
      "SECRET-CONFIGURATION-VALUE",
    );
    expect(error).toHaveBeenCalledWith("identity.controller.failed", {
      operation: "start_google_flow",
      code: "runtime_exception",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-CONFIGURATION-VALUE");
    expect(JSON.stringify(error.mock.calls)).not.toContain(HOMEGATE_BASE_URL);
  });
});

function createController(): PassportIdentityController {
  return new PassportIdentityController(GOOGLE_CLIENT_ID, HOMEGATE_BASE_URL);
}
