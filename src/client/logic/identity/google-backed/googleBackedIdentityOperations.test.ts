/** @vitest-environment jsdom */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../../../test-utils/fakes/memoryStorage";
import { LocalStorageIdentityRepository } from "../local/localStorageIdentityRepository";

const MOCKS = vi.hoisted(() => ({
  PubkySdkAdapter: vi.fn(),
  pubky: { dispose: vi.fn() },
  SaveLocalIdentity: vi.fn(),
  saveIdentity: vi.fn(),
  WrappingKeyApiClient: vi.fn(),
  requestWrappingKey: vi.fn(),
  HomegateClient: vi.fn(),
  requestSignupInvitation: vi.fn(),
  PassportFileWebCrypto: vi.fn(),
  encryptSecretKeyBytes: vi.fn(),
  decryptSecretKeyBytes: vi.fn(),
  ActivateGoogleBackedIdentity: vi.fn(),
  activateIdentity: vi.fn(),
  RestoreGoogleBackedIdentityKey: vi.fn(),
  restoreIdentityKey: vi.fn(),
  GoogleDrivePassportFileStore: vi.fn(),
  passportFileStore: {
    readPassportFile: vi.fn(),
    createPassportFile: vi.fn(),
    deletePassportFile: vi.fn(),
  },
  GoogleDriveVisibleRecoveryCopyWriter: vi.fn(),
  createVisibleRecoveryCopy: vi.fn(),
  GoogleDriveVisibleRecoveryCopyDeleter: vi.fn(),
  deleteVisibleRecoveryCopies: vi.fn(),
  CreateGoogleBackedIdentity: vi.fn(),
  createIdentity: vi.fn(),
  RestoreGoogleBackedIdentity: vi.fn(),
  restoreIdentity: vi.fn(),
  DeleteGoogleIdentityBackups: vi.fn(),
  deleteBackups: vi.fn(),
  EstablishGoogleBackedIdentity: vi.fn(),
  establishIdentity: vi.fn(),
  ResumeIncompleteGoogleBackedIdentity: vi.fn(),
  resumeIncompleteIdentity: vi.fn(),
  DetachGoogleBackedIdentity: vi.fn(),
  detachIdentity: vi.fn(),
}));

vi.mock("../../pubky/pubkySdkAdapter", () => ({ PubkySdkAdapter: MOCKS.PubkySdkAdapter }));
vi.mock("../local/saveLocalIdentity", () => ({ SaveLocalIdentity: MOCKS.SaveLocalIdentity }));
vi.mock("../../wrapping-key/wrappingKeyApiClient", () => ({ WrappingKeyApiClient: MOCKS.WrappingKeyApiClient }));
vi.mock("../../homegate/homegateClient", () => ({ HomegateClient: MOCKS.HomegateClient }));
vi.mock("../../passport-file/passportFileWebCrypto", () => ({ PassportFileWebCrypto: MOCKS.PassportFileWebCrypto }));
vi.mock("../../passport-file/googleDrivePassportFileStore", () => ({ GoogleDrivePassportFileStore: MOCKS.GoogleDrivePassportFileStore }));
vi.mock("../../passport-file/googleDriveVisibleRecoveryCopyWriter", () => ({ GoogleDriveVisibleRecoveryCopyWriter: MOCKS.GoogleDriveVisibleRecoveryCopyWriter }));
vi.mock("../../passport-file/googleDriveVisibleRecoveryCopyDeleter", () => ({ GoogleDriveVisibleRecoveryCopyDeleter: MOCKS.GoogleDriveVisibleRecoveryCopyDeleter }));
vi.mock("./activateGoogleBackedIdentity", () => ({ ActivateGoogleBackedIdentity: MOCKS.ActivateGoogleBackedIdentity }));
vi.mock("./createGoogleBackedIdentity", () => ({ CreateGoogleBackedIdentity: MOCKS.CreateGoogleBackedIdentity }));
vi.mock("./restoreGoogleBackedIdentity", () => ({ RestoreGoogleBackedIdentity: MOCKS.RestoreGoogleBackedIdentity }));
vi.mock("./restoreGoogleBackedIdentityKey", () => ({ RestoreGoogleBackedIdentityKey: MOCKS.RestoreGoogleBackedIdentityKey }));
vi.mock("./deleteGoogleIdentityBackups", () => ({ DeleteGoogleIdentityBackups: MOCKS.DeleteGoogleIdentityBackups }));
vi.mock("./establishGoogleBackedIdentity", () => ({ EstablishGoogleBackedIdentity: MOCKS.EstablishGoogleBackedIdentity }));
vi.mock("./resumeIncompleteGoogleBackedIdentity", () => ({ ResumeIncompleteGoogleBackedIdentity: MOCKS.ResumeIncompleteGoogleBackedIdentity }));
vi.mock("./detachGoogleBackedIdentity", () => ({ DetachGoogleBackedIdentity: MOCKS.DetachGoogleBackedIdentity }));

import { GoogleBackedIdentityOperations } from "./googleBackedIdentityOperations";

const CREDENTIALS = {
  googleIdToken: "google-id-token",
  driveAccessToken: "drive-access-token",
  googleAccount: { id: "account", email: "a@example.com", name: "A", pictureUrl: null },
};
const PUBLIC_IDENTITY = { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" };

describe("GoogleBackedIdentityOperations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MOCKS.PubkySdkAdapter.mockImplementation(function () { return MOCKS.pubky; });
    MOCKS.SaveLocalIdentity.mockImplementation(function () { return { saveIdentity: MOCKS.saveIdentity }; });
    MOCKS.WrappingKeyApiClient.mockImplementation(function () { return { requestGoogleWrappingKey: MOCKS.requestWrappingKey }; });
    MOCKS.HomegateClient.mockImplementation(function () { return { requestGoogleHomeserverSignupInvitation: MOCKS.requestSignupInvitation }; });
    MOCKS.PassportFileWebCrypto.mockImplementation(function () { return {
      encryptSecretKeyBytes: MOCKS.encryptSecretKeyBytes,
      decryptSecretKeyBytes: MOCKS.decryptSecretKeyBytes,
    }; });
    MOCKS.GoogleDrivePassportFileStore.mockImplementation(function () { return MOCKS.passportFileStore; });
    MOCKS.GoogleDriveVisibleRecoveryCopyWriter.mockImplementation(function () { return {
      createVisibleRecoveryCopy: MOCKS.createVisibleRecoveryCopy,
    }; });
    MOCKS.GoogleDriveVisibleRecoveryCopyDeleter.mockImplementation(function () { return {
      deleteVisibleRecoveryCopies: MOCKS.deleteVisibleRecoveryCopies,
    }; });
    MOCKS.ActivateGoogleBackedIdentity.mockImplementation(function () { return { execute: MOCKS.activateIdentity }; });
    MOCKS.RestoreGoogleBackedIdentityKey.mockImplementation(function () { return { execute: MOCKS.restoreIdentityKey }; });
    MOCKS.CreateGoogleBackedIdentity.mockImplementation(function () { return { execute: MOCKS.createIdentity }; });
    MOCKS.RestoreGoogleBackedIdentity.mockImplementation(function () { return { execute: MOCKS.restoreIdentity }; });
    MOCKS.DeleteGoogleIdentityBackups.mockImplementation(function () { return { deleteGoogleIdentityBackups: MOCKS.deleteBackups }; });
    MOCKS.EstablishGoogleBackedIdentity.mockImplementation(function () { return { execute: MOCKS.establishIdentity }; });
    MOCKS.ResumeIncompleteGoogleBackedIdentity.mockImplementation(function () { return { execute: MOCKS.resumeIncompleteIdentity }; });
    MOCKS.DetachGoogleBackedIdentity.mockImplementation(function () { return { execute: MOCKS.detachIdentity }; });
    MOCKS.establishIdentity.mockResolvedValue(Result.ok({ establishmentMode: "restored", publicIdentity: PUBLIC_IDENTITY }));
    MOCKS.resumeIncompleteIdentity.mockResolvedValue(Result.ok({ establishmentMode: "restored", publicIdentity: PUBLIC_IDENTITY }));
    MOCKS.detachIdentity.mockResolvedValue(Result.ok({ deletionStatus: "deleted" }));
  });

  it("shares one Pubky adapter across key-owning behaviors", () => {
    const repository = new LocalStorageIdentityRepository(new MemoryStorage());

    new GoogleBackedIdentityOperations({
      repository,
      homegateBaseUrl: "https://homegate.example/",
      passportOrigin: "https://passport.example",
    });

    expect(MOCKS.PubkySdkAdapter).toHaveBeenCalledOnce();
    expect(MOCKS.SaveLocalIdentity).toHaveBeenCalledWith(repository, MOCKS.pubky);
    expect(MOCKS.CreateGoogleBackedIdentity).toHaveBeenCalledWith(expect.objectContaining({ pubky: MOCKS.pubky }));
    expect(MOCKS.ActivateGoogleBackedIdentity).toHaveBeenCalledWith(expect.objectContaining({ pubky: MOCKS.pubky }));
    expect(MOCKS.RestoreGoogleBackedIdentity).toHaveBeenCalledWith(expect.any(Function), MOCKS.pubky, expect.any(Function));
    expect(MOCKS.RestoreGoogleBackedIdentityKey).toHaveBeenCalledWith(expect.objectContaining({ pubky: MOCKS.pubky }));
    expect(MOCKS.DeleteGoogleIdentityBackups).toHaveBeenCalledWith(expect.objectContaining({ pubky: MOCKS.pubky }));
  });

  it("delegates public behaviors and disposes the adapter once", async () => {
    const operations = new GoogleBackedIdentityOperations({
      repository: new LocalStorageIdentityRepository(new MemoryStorage()),
      homegateBaseUrl: "https://homegate.example/",
      passportOrigin: "https://passport.example",
    });
    const reportProgress = vi.fn();

    await operations.establishIdentity(CREDENTIALS, reportProgress);
    await operations.resumeIncompleteIdentity(CREDENTIALS, PUBLIC_IDENTITY, reportProgress);
    await operations.detachIdentity(CREDENTIALS, PUBLIC_IDENTITY, "account");
    operations.dispose();
    operations.dispose();

    expect(MOCKS.establishIdentity).toHaveBeenCalledWith(CREDENTIALS, reportProgress);
    expect(MOCKS.resumeIncompleteIdentity).toHaveBeenCalledWith(
      CREDENTIALS,
      PUBLIC_IDENTITY,
      reportProgress,
    );
    expect(MOCKS.detachIdentity).toHaveBeenCalledWith(CREDENTIALS, PUBLIC_IDENTITY, "account");
    expect(MOCKS.pubky.dispose).toHaveBeenCalledOnce();
  });
});
