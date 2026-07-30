/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../../../libs/logger/logger";

const MOCKS = vi.hoisted(() => ({
  PubkySdkAdapter: vi.fn(),
  pubky: {
    createIdentityKey: vi.fn(),
    restoreIdentityKey: vi.fn(),
    disposeIdentityKey: vi.fn(),
    exportSecretKey: vi.fn(),
    getPublicIdentity: vi.fn(),
    signup: vi.fn(),
    signin: vi.fn(),
    publishHomeserverIfStale: vi.fn(),
    dispose: vi.fn(),
  },
  WebCryptoPassportFileCrypto: vi.fn(),
  crypto: {
    encryptSecretKeyBytes() {},
    decryptSecretKeyBytes() {},
  },
  SaveLocalIdentity: vi.fn(),
  localIdentities: {},
  CreateGoogleBackedIdentity: vi.fn(),
  createMissingIdentity: {},
  DeleteGoogleDrivePassportFile: vi.fn(),
  EstablishGoogleBackedIdentity: vi.fn(),
  RestoreGoogleBackedIdentity: vi.fn(),
  restoreExistingIdentity: {},
  HomegateClient: vi.fn(),
  homegate: {},
  WrappingKeyApiClient: vi.fn(),
  wrappingKeyApiClient: { requestGoogleWrappingKey() {} },
}));

vi.mock("../../../pubky/adapters/pubkySdkAdapter", () => ({
  PubkySdkAdapter: MOCKS.PubkySdkAdapter,
}));

vi.mock("../../../passport-file/adapters/webCryptoPassportFileCrypto", () => ({
  WebCryptoPassportFileCrypto: MOCKS.WebCryptoPassportFileCrypto,
}));

vi.mock("../../local-identity/application/saveLocalIdentity", () => ({
  SaveLocalIdentity: MOCKS.SaveLocalIdentity,
}));

vi.mock("../application/createGoogleBackedIdentity", () => ({
  CreateGoogleBackedIdentity: MOCKS.CreateGoogleBackedIdentity,
}));

vi.mock("../application/deleteGoogleDrivePassportFile", () => ({
  DeleteGoogleDrivePassportFile: MOCKS.DeleteGoogleDrivePassportFile,
}));

vi.mock("../application/establishGoogleBackedIdentity", () => ({
  EstablishGoogleBackedIdentity: MOCKS.EstablishGoogleBackedIdentity,
}));

vi.mock("../application/restoreGoogleBackedIdentity", () => ({
  RestoreGoogleBackedIdentity: MOCKS.RestoreGoogleBackedIdentity,
}));

vi.mock("../../../homegate/homegateClient", () => ({
  HomegateClient: MOCKS.HomegateClient,
}));

vi.mock("../../../wrapping-key/wrappingKeyApiClient", () => ({
  WrappingKeyApiClient: MOCKS.WrappingKeyApiClient,
}));

import { GoogleBackedIdentityOperations } from "./googleBackedIdentityOperations";

describe("GoogleBackedIdentityOperations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wires and delegates Google-backed identity operations", async () => {
    const identityEstablisher = operationDouble();
    const passportFileDeleter = deletionDouble();
    const saveIdentityRecord = sanitizedSaveIdentityRecord();
    prepareConstructors({ identityEstablisher, passportFileDeleter });
    const credentials = { googleIdToken: "google-id-token", driveAccessToken: "drive-access-token" };

    const operations = new GoogleBackedIdentityOperations({
      saveIdentityRecord,
      homegateBaseUrl: "https://homegate.example/api/",
      passportOrigin: "https://passport.example",
    });

    expect(MOCKS.HomegateClient).toHaveBeenCalledWith({
      homegateBaseUrl: "https://homegate.example/api/",
    });
    expect(MOCKS.SaveLocalIdentity).toHaveBeenCalledWith({
      saveIdentityRecord,
      pubky: MOCKS.pubky,
    });
    expect(MOCKS.RestoreGoogleBackedIdentity).toHaveBeenCalledWith({
      decryptSecretKeyBytes: expect.any(Function),
      pubky: MOCKS.pubky,
      localIdentities: MOCKS.localIdentities,
      passportOrigin: "https://passport.example",
    });
    expect(MOCKS.CreateGoogleBackedIdentity).toHaveBeenCalledWith({
      encryptSecretKeyBytes: expect.any(Function),
      pubky: MOCKS.pubky,
      localIdentities: MOCKS.localIdentities,
      passportOrigin: "https://passport.example",
    });
    expect(MOCKS.EstablishGoogleBackedIdentity).toHaveBeenCalledWith({
      requestWrappingKey: expect.any(Function),
      readPassportFile: expect.any(Function),
      createPassportFile: expect.any(Function),
      homegate: MOCKS.homegate,
      restoreExistingIdentity: MOCKS.restoreExistingIdentity,
      createMissingIdentity: MOCKS.createMissingIdentity,
    });
    expect(MOCKS.DeleteGoogleDrivePassportFile).toHaveBeenCalledWith(expect.objectContaining({
      requestWrappingKey: expect.any(Function),
      readPassportFile: expect.any(Function),
      deletePassportFile: expect.any(Function),
      decryptSecretKeyBytes: expect.any(Function),
      pubky: MOCKS.pubky,
      passportOrigin: "https://passport.example",
    }));

    await operations.establishGoogleBackedIdentity(credentials);
    await operations.deleteGoogleDrivePassportFile(credentials, "public-key");
    expect(identityEstablisher.receivedExpectedCredentials).toBe(true);
    expect(passportFileDeleter.receivedExpectedInput).toBe(true);

    operations.dispose();
    operations.dispose();
    expect(MOCKS.pubky.dispose).toHaveBeenCalledOnce();
  });

  it("disposes Pubky when construction fails", () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    prepareConstructors({
      identityEstablisher: operationDouble(),
      passportFileDeleter: deletionDouble(),
    });
    MOCKS.CreateGoogleBackedIdentity.mockImplementationOnce(function () {
      throw new Error("construction failed");
    });
    MOCKS.pubky.dispose.mockImplementationOnce(() => {
      throw new Error("dispose failed");
    });

    expect(() => new GoogleBackedIdentityOperations({
      saveIdentityRecord: sanitizedSaveIdentityRecord(),
      homegateBaseUrl: "https://homegate.example/",
      passportOrigin: "https://passport.example",
    })).toThrow("construction failed");
    expect(MOCKS.pubky.dispose).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("identity.google.cleanup.failed", {
      operation: "construction_pubky_dispose",
    });
  });
});

function prepareConstructors(input: {
  identityEstablisher: ReturnType<typeof operationDouble>;
  passportFileDeleter: ReturnType<typeof deletionDouble>;
}): void {
  vi.clearAllMocks();
  MOCKS.PubkySdkAdapter.mockImplementation(function () {
    return MOCKS.pubky;
  });
  MOCKS.WebCryptoPassportFileCrypto.mockImplementation(function () {
    return MOCKS.crypto;
  });
  MOCKS.SaveLocalIdentity.mockImplementation(function () {
    return MOCKS.localIdentities;
  });
  MOCKS.WrappingKeyApiClient.mockImplementation(function () {
    return MOCKS.wrappingKeyApiClient;
  });
  MOCKS.HomegateClient.mockImplementation(function () {
    return MOCKS.homegate;
  });
  MOCKS.RestoreGoogleBackedIdentity.mockImplementation(function () {
    return MOCKS.restoreExistingIdentity;
  });
  MOCKS.CreateGoogleBackedIdentity.mockImplementation(function () {
    return MOCKS.createMissingIdentity;
  });
  MOCKS.EstablishGoogleBackedIdentity.mockImplementation(function () {
    return input.identityEstablisher;
  });
  MOCKS.DeleteGoogleDrivePassportFile.mockImplementation(function () {
    return input.passportFileDeleter;
  });
}

function operationDouble() {
  return {
    receivedExpectedCredentials: false,
    async establish(credentials: { googleIdToken: string; driveAccessToken: string }) {
      this.receivedExpectedCredentials = credentials.googleIdToken.length > 0
        && credentials.driveAccessToken.length > 0;
    },
  };
}

function deletionDouble() {
  return {
    receivedExpectedInput: false,
    async deleteGoogleDrivePassportFile(
      credentials: { googleIdToken: string; driveAccessToken: string },
      expectedPublicKeyZ32: string,
    ) {
      this.receivedExpectedInput = credentials.googleIdToken.length > 0
        && credentials.driveAccessToken.length > 0
        && expectedPublicKeyZ32 === "public-key";
    },
  };
}

function sanitizedSaveIdentityRecord() {
  return () => Result.err({ code: "storage_unavailable" as const });
}
