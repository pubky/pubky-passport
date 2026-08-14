/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../../../test-utils/fakes/memoryStorage";
import { expectResultError } from "../../../../../test-utils/resultAssertions";
import { LocalStorageIdentityRepository } from "../local/localStorageIdentityRepository";

const MOCKS = vi.hoisted(() => ({
  GoogleBackedIdentityOperations: vi.fn(),
  GoogleImplicitAuthorization: vi.fn(),
  detachIdentity: vi.fn(),
  disposeAuthorization: vi.fn(),
  disposeOperations: vi.fn(),
  establishIdentity: vi.fn(),
  prepareAuthorization: vi.fn(),
  resumeIncompleteIdentity: vi.fn(),
  requestAuthorization: vi.fn(),
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

    MOCKS.GoogleImplicitAuthorization.mockImplementation(function () { return {
      prepare: MOCKS.prepareAuthorization,
      request: MOCKS.requestAuthorization,
      dispose: MOCKS.disposeAuthorization,
    }; });
    MOCKS.GoogleBackedIdentityOperations.mockImplementation(function () { return {
      establishIdentity: MOCKS.establishIdentity,
      resumeIncompleteIdentity: MOCKS.resumeIncompleteIdentity,
      detachIdentity: MOCKS.detachIdentity,
      dispose: MOCKS.disposeOperations,
    }; });
    MOCKS.prepareAuthorization.mockResolvedValue(Result.ok());
    MOCKS.requestAuthorization.mockResolvedValue(Result.ok(CREDENTIALS));
    MOCKS.establishIdentity.mockImplementation(async (_credentials, reportProgress) => {
      reportProgress("checking_passport_file");
      reportProgress("restoring_identity");
      return Result.ok({ establishmentMode: "restored" as const, publicIdentity: PUBLIC_IDENTITY });
    });
    MOCKS.resumeIncompleteIdentity.mockResolvedValue(Result.ok({
      establishmentMode: "restored" as const,
      publicIdentity: PUBLIC_IDENTITY,
    }));
    MOCKS.detachIdentity.mockResolvedValue(Result.ok({ deletionStatus: "deleted" as const }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports readiness, authorization, and establishment progress", async () => {
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
    expect(MOCKS.establishIdentity).toHaveBeenCalledWith(CREDENTIALS, expect.any(Function));
  });

  it("returns a direct authorization error without constructing operations", async () => {
    MOCKS.requestAuthorization.mockResolvedValue(Result.err({
      code: "google_authorization_popup_closed" as const,
    }));
    const flow = createFlow();

    expectResultError(await flow.establishIdentity(), { code: "authorization_failed" });
    expect(MOCKS.GoogleBackedIdentityOperations).not.toHaveBeenCalled();
  });

  it("rejects a different Google account before delegation", async () => {
    MOCKS.requestAuthorization.mockResolvedValue(Result.ok({
      ...CREDENTIALS,
      googleAccount: { ...GOOGLE_ACCOUNT, id: "different-account" },
    }));
    const flow = createFlow();

    expectResultError(
      await flow.detachIdentity(PUBLIC_IDENTITY, GOOGLE_ACCOUNT.id),
      { code: "authorization_failed" },
    );
    expect(MOCKS.detachIdentity).not.toHaveBeenCalled();
  });

  it("delegates incomplete setup resumption and detachment behaviors", async () => {
    const flow = createFlow();

    await expect(flow.resumeIncompleteIdentity(PUBLIC_IDENTITY, GOOGLE_ACCOUNT.id)).resolves.toEqual(Result.ok({
      establishmentMode: "restored",
      googleAccount: GOOGLE_ACCOUNT,
      publicIdentity: PUBLIC_IDENTITY,
    }));
    await expect(flow.detachIdentity(PUBLIC_IDENTITY, GOOGLE_ACCOUNT.id)).resolves.toEqual(
      Result.ok({ deletionStatus: "deleted" }),
    );

    expect(MOCKS.resumeIncompleteIdentity).toHaveBeenCalledWith(
      CREDENTIALS,
      PUBLIC_IDENTITY,
      expect.any(Function),
    );
    expect(MOCKS.detachIdentity).toHaveBeenCalledWith(CREDENTIALS, PUBLIC_IDENTITY, GOOGLE_ACCOUNT.id);
  });

  it("returns safe resume context for an incomplete identity", async () => {
    MOCKS.establishIdentity.mockResolvedValue(Result.err({
      code: "signin_failed" as const,
      preservedPassportFileIdentity: PUBLIC_IDENTITY,
    }));

    expectResultError(await createFlow().establishIdentity(), {
      code: "signin_failed",
      incompleteIdentity: { googleAccount: GOOGLE_ACCOUNT, publicIdentity: PUBLIC_IDENTITY },
    });
  });

  it("defers operation cleanup until in-flight work settles", async () => {
    let finish!: () => void;
    MOCKS.establishIdentity.mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve(Result.ok({
        establishmentMode: "restored" as const,
        publicIdentity: PUBLIC_IDENTITY,
      }));
    }));
    const flow = createFlow();

    const pending = flow.establishIdentity();
    await vi.waitFor(() => expect(MOCKS.establishIdentity).toHaveBeenCalledOnce());
    flow.dispose();
    expect(MOCKS.disposeOperations).not.toHaveBeenCalled();
    finish();

    expectResultError(await pending, { code: "cancelled" });
    expect(MOCKS.disposeOperations).toHaveBeenCalledOnce();
  });

  it("rejects a concurrent operation without another authorization", async () => {
    let finish!: () => void;
    MOCKS.establishIdentity.mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve(Result.ok({
        establishmentMode: "restored" as const,
        publicIdentity: PUBLIC_IDENTITY,
      }));
    }));
    const flow = createFlow();

    const first = flow.establishIdentity();
    await vi.waitFor(() => expect(MOCKS.establishIdentity).toHaveBeenCalledOnce());
    expectResultError(
      await flow.detachIdentity(PUBLIC_IDENTITY, GOOGLE_ACCOUNT.id),
      { code: "operation_failed" },
    );
    expect(MOCKS.requestAuthorization).toHaveBeenCalledOnce();
    finish();
    await first;
  });
});

function createFlow(
  onState: (state: GoogleIdentityFlowState) => void = vi.fn(),
): GoogleBackedIdentityFlow {
  return new GoogleBackedIdentityFlow(
    new LocalStorageIdentityRepository(),
    new MOCKS.GoogleImplicitAuthorization(),
    "https://homegate.example/",
    window.location.origin,
    onState,
  );
}
