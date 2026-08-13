/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../test-utils/fakes/memoryStorage";
import { LOGGER } from "../../libs/logger/logger";
import { PUBKY_SECRET_KEY_FORMAT } from "../pubky/pubkyIdentityKey";
import { LocalStorageIdentityRepository } from "./local/localStorageIdentityRepository";
const MOCKS = vi.hoisted(() => ({
  GoogleBackedIdentityOperations: vi.fn(),
  disposeGoogleBackedIdentityOperations: vi.fn(),
  establishCalls: 0,
  establishReceivedExpectedCredentials: false,
  establishProgress: [] as string[],
  establishImplementation: null as null | (() => Promise<unknown>),
  deleteCalls: 0,
  deleteReceivedExpectedInput: false,
  GoogleImplicitAuthorization: vi.fn(),
  prepareGoogleAuthorization: vi.fn(),
  requestGoogleAuthorization: vi.fn(),
  disposeGoogleAuthorization: vi.fn(),
}));

vi.mock("./google-backed/googleBackedIdentityOperations", () => ({
  GoogleBackedIdentityOperations: MOCKS.GoogleBackedIdentityOperations,
}));

vi.mock("../google-authorization/googleImplicitAuthorization", () => ({
  GoogleImplicitAuthorization: MOCKS.GoogleImplicitAuthorization,
}));

import { PassportIdentityController } from "./passportIdentityController";

const GOOGLE_CLIENT_ID = "google-client-id";
const HOMEGATE_BASE_URL = "https://homegate.example/";
const GOOGLE_ACCOUNT = { id: "google-account-id", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: null };
const PUBLIC_IDENTITY = { publicKeyZ32: "public-key", publicKeyDisplay: "pubky1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy" };
const DETACH_ACTION = { kind: "detach_google_backed_identity" as const, publicIdentity: PUBLIC_IDENTITY, expectedGoogleAccountId: GOOGLE_ACCOUNT.id };

function createController() {
  return new PassportIdentityController(GOOGLE_CLIENT_ID, HOMEGATE_BASE_URL);
}

describe("PassportIdentityController composition", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    MOCKS.GoogleBackedIdentityOperations.mockReset();
    MOCKS.disposeGoogleBackedIdentityOperations.mockReset();
    MOCKS.establishCalls = 0;
    MOCKS.establishReceivedExpectedCredentials = false;
    MOCKS.establishProgress = [];
    MOCKS.deleteCalls = 0;
    MOCKS.deleteReceivedExpectedInput = false;
    MOCKS.GoogleImplicitAuthorization.mockReset();
    MOCKS.prepareGoogleAuthorization.mockReset();
    MOCKS.requestGoogleAuthorization.mockReset();
    MOCKS.disposeGoogleAuthorization.mockReset();

    MOCKS.GoogleBackedIdentityOperations.mockImplementation(function () {
      return {
        async restoreOrCreateGoogleBackedIdentity(
          credentials: { googleIdToken: string; driveAccessToken: string },
          reportProgress: (progress: "checking_passport_file" | "restoring_identity") => void,
        ) {
          MOCKS.establishCalls += 1;
          MOCKS.establishReceivedExpectedCredentials = credentials.googleIdToken.length > 0
            && credentials.driveAccessToken.length > 0;
          reportProgress("checking_passport_file");
          reportProgress("restoring_identity");
          MOCKS.establishProgress.push("checking_passport_file", "restoring_identity");
          return MOCKS.establishImplementation?.();
        },
        async deleteGoogleIdentityBackups(
          credentials: { googleIdToken: string; driveAccessToken: string },
          publicIdentity: { publicKeyZ32: string },
        ) {
          MOCKS.deleteCalls += 1;
          MOCKS.deleteReceivedExpectedInput = credentials.googleIdToken.length > 0
            && credentials.driveAccessToken.length > 0
            && publicIdentity.publicKeyZ32 === "public-key";
          return Result.ok({ status: "deleted" as const });
        },
        dispose: MOCKS.disposeGoogleBackedIdentityOperations,
      };
    });
    MOCKS.GoogleImplicitAuthorization.mockImplementation(function () {
      return {
        prepare: MOCKS.prepareGoogleAuthorization,
        request: MOCKS.requestGoogleAuthorization,
        dispose: MOCKS.disposeGoogleAuthorization,
      };
    });
    MOCKS.prepareGoogleAuthorization.mockResolvedValue(Result.ok());
    MOCKS.requestGoogleAuthorization.mockResolvedValue(Result.ok({ googleIdToken: "google-id-token", driveAccessToken: "drive-access-token", googleAccount: GOOGLE_ACCOUNT }));
    MOCKS.establishImplementation = async () => Result.ok({
      establishmentMode: "restored",
      publicIdentity: PUBLIC_IDENTITY,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("logs construction failures without configuration or exception details", () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    MOCKS.GoogleImplicitAuthorization.mockImplementationOnce(() => {
      throw new Error("SECRET-CONFIGURATION-VALUE");
    });

    expect(() => createController()).toThrow("SECRET-CONFIGURATION-VALUE");
    expect(error).toHaveBeenCalledWith("identity.controller.failed", {
      operation: "initialize",
      code: "runtime_exception",
    });
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-CONFIGURATION-VALUE");
    expect(JSON.stringify(error.mock.calls)).not.toContain(HOMEGATE_BASE_URL);
  });

  it("serves the local identity catalog without constructing the Pubky action graph", () => {
    const controller = createController();

    const identities = controller.list();
    expect(Result.isError(identities)).toBe(false);
    if (Result.isError(identities)) throw new Error(identities.error.code);
    expect(identities.value).toEqual({ activeIdentityId: null, identities: [] });
    expect(MOCKS.GoogleBackedIdentityOperations).not.toHaveBeenCalled();

    controller.dispose();
    expect(MOCKS.GoogleBackedIdentityOperations).not.toHaveBeenCalled();
  });

  it("constructs one action graph and delegates establish and detach", async () => {
    const controller = createController();
    await mountWithGoogleCredential(controller);

    await expect(controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" })).resolves.toEqual({
      status: "action_completed",
      result: Result.ok({
        kind: "google_backed_identity_established",
        establishmentMode: "restored",
        publicIdentity: PUBLIC_IDENTITY,
      }),
    });
    expect(MOCKS.GoogleBackedIdentityOperations).toHaveBeenCalledWith({
      repository: expect.any(LocalStorageIdentityRepository),
      homegateBaseUrl: "https://homegate.example/",
      passportOrigin: window.location.origin,
    });
    expect(MOCKS.establishCalls).toBe(1);
    expect(MOCKS.establishReceivedExpectedCredentials).toBe(true);
    expect(MOCKS.establishProgress).toEqual(["checking_passport_file", "restoring_identity"]);
    seedLocalIdentity();
    await expect(controller.continueGoogleBackedIdentityAction(DETACH_ACTION)).resolves.toEqual({
      status: "action_completed",
      result: Result.ok({ kind: "google_backed_identity_detached", deletionStatus: "deleted" }),
    });
    expect(MOCKS.GoogleBackedIdentityOperations).toHaveBeenCalledOnce();
    expect(MOCKS.deleteCalls).toBe(1);
    expect(MOCKS.deleteReceivedExpectedInput).toBe(true);
    expect(controller.list()).toEqual(Result.ok({ activeIdentityId: null, identities: [] }));

    controller.dispose();
    controller.dispose();
    expect(MOCKS.disposeGoogleBackedIdentityOperations).toHaveBeenCalledOnce();
  });

  it("constructs the action graph when detach is the first action", async () => {
    seedLocalIdentity();
    const controller = createController();
    await mountWithGoogleCredential(controller);

    await expect(controller.continueGoogleBackedIdentityAction(DETACH_ACTION)).resolves.toEqual({
      status: "action_completed",
      result: Result.ok({ kind: "google_backed_identity_detached", deletionStatus: "deleted" }),
    });
    expect(MOCKS.GoogleBackedIdentityOperations).toHaveBeenCalledOnce();
    expect(MOCKS.deleteCalls).toBe(1);
    expect(MOCKS.deleteReceivedExpectedInput).toBe(true);
    expect(controller.list()).toEqual(Result.ok({ activeIdentityId: null, identities: [] }));

    controller.dispose();
    expect(MOCKS.disposeGoogleBackedIdentityOperations).toHaveBeenCalledOnce();
  });

  it("rolls back a partially constructed action graph before retrying", async () => {
    MOCKS.GoogleBackedIdentityOperations.mockImplementationOnce(function () {
      throw new Error("construction failed");
    });
    const controller = createController();
    await mountWithGoogleCredential(controller);

    const failed = await controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" });
    expect(failed.status).toBe("action_completed");
    if (failed.status !== "action_completed") throw new Error("Expected completed action");
    expect(Result.isError(failed.result)).toBe(true);
    if (!Result.isError(failed.result)) throw new Error("Expected construction failure");
    expect(failed.result.error).toEqual({ code: "unexpected_failure" });
    expect(MOCKS.GoogleBackedIdentityOperations).toHaveBeenCalledOnce();
    expect(MOCKS.disposeGoogleBackedIdentityOperations).not.toHaveBeenCalled();

    await expect(controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" })).resolves.toMatchObject({
      status: "action_completed",
      result: { value: { kind: "google_backed_identity_established" } },
    });
    expect(MOCKS.GoogleBackedIdentityOperations).toHaveBeenCalledTimes(2);

    controller.dispose();
    expect(MOCKS.disposeGoogleBackedIdentityOperations).toHaveBeenCalledOnce();
  });

  it("defers action graph disposal until an in-flight action settles", async () => {
    let resolveEstablish!: (result: ReturnType<typeof establishedIdentity>) => void;
    MOCKS.establishImplementation = () => new Promise((resolve) => {
      resolveEstablish = resolve;
    });
    const controller = createController();
    await mountWithGoogleCredential(controller);

    const pending = controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" });
    await vi.waitFor(() => expect(MOCKS.establishCalls).toBe(1));
    controller.dispose();
    expect(MOCKS.disposeGoogleBackedIdentityOperations).not.toHaveBeenCalled();

    resolveEstablish(establishedIdentity());
    await expect(pending).resolves.toMatchObject({ status: "action_finished_after_unmount" });
    expect(MOCKS.disposeGoogleBackedIdentityOperations).toHaveBeenCalledOnce();
  });
});

function seedLocalIdentity(): void {
  const repository = new LocalStorageIdentityRepository();
  const saved = repository.save(
    { id: "public-key", publicIdentity: PUBLIC_IDENTITY, googleAccount: GOOGLE_ACCOUNT },
    { bytes: new Uint8Array(32).fill(7), format: PUBKY_SECRET_KEY_FORMAT },
  );
  if (Result.isError(saved)) throw new Error(saved.error.code);
}

async function mountWithGoogleCredential(
  controller: PassportIdentityController,
): Promise<void> {
  await controller.prepareGoogleAuthorization(vi.fn());
}

function establishedIdentity() {
  return Result.ok({
    establishmentMode: "restored" as const,
    publicIdentity: PUBLIC_IDENTITY,
  });
}
