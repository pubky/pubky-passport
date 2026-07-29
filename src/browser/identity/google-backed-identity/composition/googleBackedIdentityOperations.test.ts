/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

import type { LocalIdentityKeyStore } from "../../local-identity/application/localIdentityRepository";

const MOCKS = vi.hoisted(() => ({
  PubkySdkAdapter: vi.fn(),
  pubky: { dispose: vi.fn() },
  WebCryptoPassportFileCrypto: vi.fn(),
  crypto: {},
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
  GoogleWrappingKeyApiClient: vi.fn(),
  wrappingKeyRequester: {},
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

vi.mock("../../../homegate/adapters/homegateClient", () => ({
  HomegateClient: MOCKS.HomegateClient,
}));

vi.mock("../wrapping-key/adapters/googleWrappingKeyApiClient", () => ({
  GoogleWrappingKeyApiClient: MOCKS.GoogleWrappingKeyApiClient,
}));

import { GoogleBackedIdentityOperations } from "./googleBackedIdentityOperations";

describe("GoogleBackedIdentityOperations", () => {
  it("wires and delegates Google-backed identity operations", async () => {
    const identityEstablisher = operationDouble();
    const passportFileDeleter = deletionDouble();
    const keyStore = keyStoreStub();
    prepareConstructors({ identityEstablisher, passportFileDeleter });
    const credentials = { googleIdToken: "google-id-token", driveAccessToken: "drive-access-token" };

    const operations = new GoogleBackedIdentityOperations({
      keyStore,
      homegateBaseUrl: "https://homegate.example/api/",
      passportOrigin: "https://passport.example",
    });

    expect(MOCKS.HomegateClient).toHaveBeenCalledWith({
      homegateBaseUrl: "https://homegate.example/api/",
    });
    expect(MOCKS.SaveLocalIdentity).toHaveBeenCalledWith({
      keyStore,
      identityKeys: MOCKS.pubky,
    });
    expect(MOCKS.RestoreGoogleBackedIdentity).toHaveBeenCalledWith({
      crypto: MOCKS.crypto,
      identityKeys: MOCKS.pubky,
      sessionAccess: MOCKS.pubky,
      localIdentities: MOCKS.localIdentities,
      passportOrigin: "https://passport.example",
    });
    expect(MOCKS.CreateGoogleBackedIdentity).toHaveBeenCalledWith({
      crypto: MOCKS.crypto,
      identityKeys: MOCKS.pubky,
      sessionAccess: MOCKS.pubky,
      discovery: MOCKS.pubky,
      localIdentities: MOCKS.localIdentities,
      passportOrigin: "https://passport.example",
    });
    expect(MOCKS.EstablishGoogleBackedIdentity).toHaveBeenCalledWith({
      wrappingKeyRequester: MOCKS.wrappingKeyRequester,
      passportFileStoreForAccessToken: expect.any(Function),
      homegate: MOCKS.homegate,
      restoreExistingIdentity: MOCKS.restoreExistingIdentity,
      createMissingIdentity: MOCKS.createMissingIdentity,
    });
    expect(MOCKS.DeleteGoogleDrivePassportFile).toHaveBeenCalledWith(expect.objectContaining({
      wrappingKeyRequester: MOCKS.wrappingKeyRequester,
      crypto: MOCKS.crypto,
      identityKeys: MOCKS.pubky,
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
      keyStore: keyStoreStub(),
      homegateBaseUrl: "https://homegate.example/",
      passportOrigin: "https://passport.example",
    })).toThrow("construction failed");
    expect(MOCKS.pubky.dispose).toHaveBeenCalledOnce();
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
  MOCKS.GoogleWrappingKeyApiClient.mockImplementation(function () {
    return MOCKS.wrappingKeyRequester;
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

function keyStoreStub(): LocalIdentityKeyStore {
  return {} as LocalIdentityKeyStore;
}
