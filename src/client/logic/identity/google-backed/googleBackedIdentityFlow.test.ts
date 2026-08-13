/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../../../test-utils/fakes/memoryStorage";
import { PUBKY_SECRET_KEY_FORMAT } from "../../pubky/pubkyIdentityKey";
import { LocalStorageIdentityRepository } from "../local/localStorageIdentityRepository";

const MOCKS = vi.hoisted(() => ({
  GoogleBackedIdentityOperations: vi.fn(),
  GoogleImplicitAuthorization: vi.fn(),
  deleteBackups: vi.fn(),
  disposeAuthorization: vi.fn(),
  disposeOperations: vi.fn(),
  prepareAuthorization: vi.fn(),
  requestAuthorization: vi.fn(),
  restoreOrCreate: vi.fn(),
}));

vi.mock("./googleBackedIdentityOperations", () => ({
  GoogleBackedIdentityOperations: MOCKS.GoogleBackedIdentityOperations,
}));

vi.mock("../../google-authorization/googleImplicitAuthorization", () => ({
  GoogleImplicitAuthorization: MOCKS.GoogleImplicitAuthorization,
}));

import {
  GoogleBackedIdentityFlow,
  type GoogleIdentityFlowState,
} from "./googleBackedIdentityFlow";

const GOOGLE_ACCOUNT = {
  id: "google-account-id",
  email: "satoshi@gmail.com",
  name: "Satoshi Nakamoto",
  pictureUrl: null,
};
const CREDENTIALS = {
  googleIdToken: "google-id-token",
  driveAccessToken: "drive-access-token",
  googleAccount: GOOGLE_ACCOUNT,
};
const PUBLIC_IDENTITY = {
  publicKeyZ32: "public-key",
  publicKeyDisplay: "pubky1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy",
};

describe("GoogleBackedIdentityFlow", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    for (const mock of Object.values(MOCKS)) mock.mockReset();

    MOCKS.GoogleImplicitAuthorization.mockImplementation(function () {
      return {
        prepare: MOCKS.prepareAuthorization,
        request: MOCKS.requestAuthorization,
        dispose: MOCKS.disposeAuthorization,
      };
    });
    MOCKS.GoogleBackedIdentityOperations.mockImplementation(function () {
      return {
        restoreOrCreateGoogleBackedIdentity: MOCKS.restoreOrCreate,
        deleteGoogleIdentityBackups: MOCKS.deleteBackups,
        dispose: MOCKS.disposeOperations,
      };
    });
    MOCKS.prepareAuthorization.mockResolvedValue(Result.ok());
    MOCKS.requestAuthorization.mockResolvedValue(Result.ok(CREDENTIALS));
    MOCKS.restoreOrCreate.mockImplementation(async (_credentials, reportProgress) => {
      reportProgress("checking_passport_file");
      reportProgress("restoring_identity");
      return Result.ok({
        establishmentMode: "restored" as const,
        publicIdentity: PUBLIC_IDENTITY,
      });
    });
    MOCKS.deleteBackups.mockResolvedValue(Result.ok({ status: "deleted" as const }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports readiness, authorization, and restore progress in order", async () => {
    const states: GoogleIdentityFlowState[] = [];
    const flow = createFlow((state) => states.push(state));

    flow.start();
    await vi.waitFor(() => expect(states).toEqual([{ status: "ready" }]));

    await expect(flow.establishIdentity()).resolves.toEqual(Result.ok({
      establishmentMode: "restored",
      googleAccount: GOOGLE_ACCOUNT,
      publicIdentity: PUBLIC_IDENTITY,
    }));
    expect(states).toEqual([
      { status: "ready" },
      { status: "requesting-authorization" },
      { status: "establishing", progress: "checking_passport_file" },
      { status: "establishing", progress: "restoring_identity" },
      { status: "ready" },
    ]);
    expect(MOCKS.requestAuthorization).toHaveBeenCalledWith(undefined);
    expect(MOCKS.restoreOrCreate).toHaveBeenCalledWith(CREDENTIALS, expect.any(Function));
  });

  it("returns one direct authorization error when Google access fails", async () => {
    const states: GoogleIdentityFlowState[] = [];
    MOCKS.requestAuthorization.mockResolvedValue(Result.err({
      code: "google_authorization_popup_closed" as const,
    }));
    const flow = createFlow((state) => states.push(state));
    flow.start();
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ status: "ready" }));

    const established = await flow.establishIdentity();
    expect(Result.isError(established)).toBe(true);
    if (!Result.isError(established)) throw new Error("Expected authorization failure");
    expect(established.error).toEqual({ code: "authorization_failed" });
    expect(states.at(-1)).toEqual({ status: "authorization-failed" });
    expect(MOCKS.GoogleBackedIdentityOperations).not.toHaveBeenCalled();
  });

  it("does not delete data when Google returns a different account", async () => {
    MOCKS.requestAuthorization.mockResolvedValue(Result.ok({
      ...CREDENTIALS,
      googleAccount: { ...GOOGLE_ACCOUNT, id: "different-account" },
    }));
    const flow = createFlow();

    const detached = await flow.detachIdentity(PUBLIC_IDENTITY, GOOGLE_ACCOUNT.id);
    expect(Result.isError(detached)).toBe(true);
    if (!Result.isError(detached)) throw new Error("Expected authorization failure");
    expect(detached.error).toEqual({ code: "authorization_failed" });
    expect(MOCKS.requestAuthorization).toHaveBeenCalledWith(GOOGLE_ACCOUNT.id);
    expect(MOCKS.deleteBackups).not.toHaveBeenCalled();
  });

  it("deletes Google backups before removing the local identity", async () => {
    const calls: string[] = [];
    const repository = new LocalStorageIdentityRepository();
    seedIdentity(repository);
    MOCKS.deleteBackups.mockImplementation(async () => {
      calls.push("google");
      return Result.ok({ status: "deleted" as const });
    });
    vi.spyOn(repository, "remove").mockImplementation(() => {
      calls.push("local");
      return Result.ok();
    });
    const flow = createFlow(vi.fn(), repository);

    await expect(flow.detachIdentity(PUBLIC_IDENTITY, GOOGLE_ACCOUNT.id)).resolves.toEqual(
      Result.ok({ deletionStatus: "deleted" }),
    );
    expect(calls).toEqual(["google", "local"]);
    expect(MOCKS.deleteBackups).toHaveBeenCalledWith(
      CREDENTIALS,
      PUBLIC_IDENTITY,
      GOOGLE_ACCOUNT.id,
    );
  });

  it("deletes an incomplete backup before creating its replacement", async () => {
    const calls: string[] = [];
    MOCKS.deleteBackups.mockImplementation(async () => {
      calls.push("delete");
      return Result.ok({ status: "deleted" as const });
    });
    MOCKS.restoreOrCreate.mockImplementation(async () => {
      calls.push("create");
      return Result.ok({
        establishmentMode: "created" as const,
        publicIdentity: PUBLIC_IDENTITY,
        visibleRecoveryCopyStatus: "created" as const,
      });
    });
    const flow = createFlow();

    await expect(flow.replaceIncompleteIdentity(
      PUBLIC_IDENTITY,
      GOOGLE_ACCOUNT.id,
    )).resolves.toEqual(Result.ok({
      establishmentMode: "created",
      googleAccount: GOOGLE_ACCOUNT,
      publicIdentity: PUBLIC_IDENTITY,
      visibleRecoveryCopyStatus: "created",
    }));
    expect(calls).toEqual(["delete", "create"]);
    expect(MOCKS.requestAuthorization).toHaveBeenCalledWith(GOOGLE_ACCOUNT.id);
  });

  it("returns safe recovery context for an incomplete encrypted identity", async () => {
    MOCKS.restoreOrCreate.mockResolvedValue(Result.err({
      code: "signin_failed" as const,
      preservedPassportFileIdentity: PUBLIC_IDENTITY,
    }));
    const flow = createFlow();

    const established = await flow.establishIdentity();
    expect(Result.isError(established)).toBe(true);
    if (!Result.isError(established)) throw new Error("Expected establishment failure");
    expect(established.error).toEqual({
      code: "signin_failed",
      recovery: {
        googleAccount: GOOGLE_ACCOUNT,
        publicIdentity: PUBLIC_IDENTITY,
      },
    });
  });

  it("defers operation cleanup until an in-flight action settles", async () => {
    let finishRestore!: () => void;
    MOCKS.restoreOrCreate.mockImplementation(() => new Promise((resolve) => {
      finishRestore = () => resolve(Result.ok({
        establishmentMode: "restored" as const,
        publicIdentity: PUBLIC_IDENTITY,
      }));
    }));
    const flow = createFlow();

    const pending = flow.establishIdentity();
    await vi.waitFor(() => expect(MOCKS.restoreOrCreate).toHaveBeenCalledOnce());
    flow.dispose();
    expect(MOCKS.disposeOperations).not.toHaveBeenCalled();

    finishRestore();
    const established = await pending;
    expect(Result.isError(established)).toBe(true);
    if (!Result.isError(established)) throw new Error("Expected cancelled result");
    expect(established.error).toEqual({ code: "cancelled" });
    expect(MOCKS.disposeOperations).toHaveBeenCalledOnce();
  });

  it("rejects a second operation without another Google authorization", async () => {
    let finishRestore!: () => void;
    MOCKS.restoreOrCreate.mockImplementation(() => new Promise((resolve) => {
      finishRestore = () => resolve(Result.ok({
        establishmentMode: "restored" as const,
        publicIdentity: PUBLIC_IDENTITY,
      }));
    }));
    const flow = createFlow();

    const first = flow.establishIdentity();
    await vi.waitFor(() => expect(MOCKS.restoreOrCreate).toHaveBeenCalledOnce());
    const second = await flow.detachIdentity(PUBLIC_IDENTITY, GOOGLE_ACCOUNT.id);

    expect(Result.isError(second)).toBe(true);
    if (!Result.isError(second)) throw new Error("Expected concurrent operation failure");
    expect(second.error).toEqual({ code: "operation_failed" });
    expect(MOCKS.requestAuthorization).toHaveBeenCalledOnce();
    expect(MOCKS.deleteBackups).not.toHaveBeenCalled();

    finishRestore();
    await first;
  });
});

function createFlow(
  onState: (state: GoogleIdentityFlowState) => void = vi.fn(),
  repository = new LocalStorageIdentityRepository(),
): GoogleBackedIdentityFlow {
  return new GoogleBackedIdentityFlow({
    repository,
    googleClientId: "google-client-id",
    homegateBaseUrl: "https://homegate.example/",
    passportOrigin: window.location.origin,
    onState,
  });
}

function seedIdentity(repository: LocalStorageIdentityRepository): void {
  const saved = repository.save(
    {
      id: PUBLIC_IDENTITY.publicKeyZ32,
      publicIdentity: PUBLIC_IDENTITY,
      googleAccount: GOOGLE_ACCOUNT,
    },
    {
      bytes: new Uint8Array(32).fill(7),
      format: PUBKY_SECRET_KEY_FORMAT,
    },
  );
  if (Result.isError(saved)) throw new Error(saved.error.code);
}
