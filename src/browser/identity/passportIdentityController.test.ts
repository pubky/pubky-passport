/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../test-utils/fakes/memoryStorage";
import { LOGGER } from "../../libs/logger/logger";
import { LocalStorageIdentityRepository } from "./local/localStorageIdentityRepository";

const MOCKS = vi.hoisted(() => ({
  GoogleBackedIdentityFlow: vi.fn(),
  start: vi.fn(),
}));

vi.mock("./google-backed/googleBackedIdentityFlow", () => ({
  GoogleBackedIdentityFlow: MOCKS.GoogleBackedIdentityFlow,
}));

import { PassportIdentityController } from "./passportIdentityController";

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
    expect(MOCKS.GoogleBackedIdentityFlow).toHaveBeenCalledWith({
      repository: expect.any(LocalStorageIdentityRepository),
      googleClientId: GOOGLE_CLIENT_ID,
      homegateBaseUrl: HOMEGATE_BASE_URL,
      passportOrigin: window.location.origin,
      onState,
    });
    expect(MOCKS.start).toHaveBeenCalledOnce();
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
