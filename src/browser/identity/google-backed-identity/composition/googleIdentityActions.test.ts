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
  DeleteGoogleDriveIdentity: vi.fn(),
  EstablishGoogleBackedIdentity: vi.fn(),
  RestoreGoogleBackedIdentity: vi.fn(),
  restoreExistingIdentity: {},
  HomegateClient: vi.fn(),
  homegate: {},
  BrowserGoogleWrappingKeyRequester: vi.fn(),
  wrappingKeys: {},
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

vi.mock("../application/deleteGoogleDriveIdentity", () => ({
  DeleteGoogleDriveIdentity: MOCKS.DeleteGoogleDriveIdentity,
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

vi.mock("../wrapping-key/adapters/googleWrappingKeyRequester", () => ({
  BrowserGoogleWrappingKeyRequester: MOCKS.BrowserGoogleWrappingKeyRequester,
}));

import { GoogleIdentityActions } from "./googleIdentityActions";

describe("GoogleIdentityActions", () => {
  it("wires and delegates Google identity actions", async () => {
    const identityEstablisher = { establish: vi.fn() };
    const identityDeleter = { execute: vi.fn() };
    const keyStore = keyStoreStub();
    prepareConstructors({ identityEstablisher, identityDeleter });
    const google = { googleIdToken: "google-id-token", driveAccessToken: "drive-access-token" };

    const actions = new GoogleIdentityActions({
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
      wrappingKeys: MOCKS.wrappingKeys,
      passportFileStoreForAccessToken: expect.any(Function),
      homegate: MOCKS.homegate,
      restoreExistingIdentity: MOCKS.restoreExistingIdentity,
      createMissingIdentity: MOCKS.createMissingIdentity,
    });
    expect(MOCKS.DeleteGoogleDriveIdentity).toHaveBeenCalledWith(expect.objectContaining({
      wrappingKeys: MOCKS.wrappingKeys,
      crypto: MOCKS.crypto,
      identityKeys: MOCKS.pubky,
      passportOrigin: "https://passport.example",
    }));

    await actions.establish(google);
    await actions.deleteDriveIdentity(google, "public-key");
    expect(identityEstablisher.establish).toHaveBeenCalledWith(google);
    expect(identityDeleter.execute).toHaveBeenCalledWith(google, "public-key");

    actions.dispose();
    actions.dispose();
    expect(MOCKS.pubky.dispose).toHaveBeenCalledOnce();
  });

  it("disposes Pubky when construction fails", () => {
    prepareConstructors({
      identityEstablisher: { establish: vi.fn() },
      identityDeleter: { execute: vi.fn() },
    });
    MOCKS.CreateGoogleBackedIdentity.mockImplementationOnce(function () {
      throw new Error("construction failed");
    });
    MOCKS.pubky.dispose.mockImplementationOnce(() => {
      throw new Error("dispose failed");
    });

    expect(() => new GoogleIdentityActions({
      keyStore: keyStoreStub(),
      homegateBaseUrl: "https://homegate.example/",
      passportOrigin: "https://passport.example",
    })).toThrow("construction failed");
    expect(MOCKS.pubky.dispose).toHaveBeenCalledOnce();
  });
});

function prepareConstructors(input: {
  identityEstablisher: { establish: ReturnType<typeof vi.fn> };
  identityDeleter: { execute: ReturnType<typeof vi.fn> };
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
  MOCKS.BrowserGoogleWrappingKeyRequester.mockImplementation(function () {
    return MOCKS.wrappingKeys;
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
  MOCKS.DeleteGoogleDriveIdentity.mockImplementation(function () {
    return input.identityDeleter;
  });
}

function keyStoreStub(): LocalIdentityKeyStore {
  return {} as LocalIdentityKeyStore;
}
