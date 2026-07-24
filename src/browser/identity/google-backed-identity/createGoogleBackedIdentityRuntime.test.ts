/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

import type { LocalIdentityRepository } from "../application/ports/localIdentityRepository";

const mocks = vi.hoisted(() => ({
  BrowserPubky: vi.fn(),
  pubky: { dispose: vi.fn() },
  WebCryptoPassportFileCrypto: vi.fn(),
  crypto: {},
  LocalIdentityService: vi.fn(),
  localIdentities: {},
  CreateGoogleBackedIdentity: vi.fn(),
  createMissingIdentity: {},
  DeleteGoogleDriveIdentity: vi.fn(),
  EstablishGoogleBackedIdentity: vi.fn(),
  RestoreGoogleBackedIdentity: vi.fn(),
  restoreExistingIdentity: {},
  BrowserGoogleHomegateInvitationRequester: vi.fn(),
  homegateInvitationRequester: {},
  BrowserGoogleWrappingKeyRequester: vi.fn(),
  wrappingKeys: {},
}));

vi.mock("../../pubky/browserPubky", () => ({
  BrowserPubky: mocks.BrowserPubky,
}));

vi.mock("../../passport-file/webCryptoPassportFileCrypto", () => ({
  WebCryptoPassportFileCrypto: mocks.WebCryptoPassportFileCrypto,
}));

vi.mock("../application/localIdentityService", () => ({
  LocalIdentityService: mocks.LocalIdentityService,
}));

vi.mock("./application/createGoogleBackedIdentity", () => ({
  CreateGoogleBackedIdentity: mocks.CreateGoogleBackedIdentity,
}));

vi.mock("./application/deleteGoogleDriveIdentity", () => ({
  DeleteGoogleDriveIdentity: mocks.DeleteGoogleDriveIdentity,
}));

vi.mock("./application/establishGoogleBackedIdentity", () => ({
  EstablishGoogleBackedIdentity: mocks.EstablishGoogleBackedIdentity,
}));

vi.mock("./application/restoreGoogleBackedIdentity", () => ({
  RestoreGoogleBackedIdentity: mocks.RestoreGoogleBackedIdentity,
}));

vi.mock("./homegate-invitation/adapters/googleHomegateInvitationRequester", () => ({
  BrowserGoogleHomegateInvitationRequester: mocks.BrowserGoogleHomegateInvitationRequester,
}));

vi.mock("./wrapping-key/adapters/googleWrappingKeyRequester", () => ({
  BrowserGoogleWrappingKeyRequester: mocks.BrowserGoogleWrappingKeyRequester,
}));

import { createGoogleBackedIdentityRuntime } from "./createGoogleBackedIdentityRuntime";

describe("createGoogleBackedIdentityRuntime", () => {
  it("wires the feature with its validated Homegate URL and Passport origin", () => {
    const identityEstablisher = { establish: vi.fn() };
    const identityDeleter = { execute: vi.fn() };
    const repository = repositoryStub();
    prepareConstructors({ identityEstablisher, identityDeleter });

    const runtime = createGoogleBackedIdentityRuntime({
      repository,
      homegateBaseUrl: "https://homegate.example/api/",
      passportOrigin: "https://passport.example",
    });

    expect(mocks.BrowserGoogleHomegateInvitationRequester).toHaveBeenCalledWith({
      homegateBaseUrl: "https://homegate.example/api/",
    });
    expect(mocks.LocalIdentityService).toHaveBeenCalledWith({
      repository,
      identityKeys: mocks.pubky,
    });
    expect(mocks.RestoreGoogleBackedIdentity).toHaveBeenCalledWith({
      crypto: mocks.crypto,
      identityKeys: mocks.pubky,
      signup: mocks.pubky,
      localIdentities: mocks.localIdentities,
      passportOrigin: "https://passport.example",
    });
    expect(mocks.CreateGoogleBackedIdentity).toHaveBeenCalledWith({
      crypto: mocks.crypto,
      identityKeys: mocks.pubky,
      homegateInvitationRequester: mocks.homegateInvitationRequester,
      signup: mocks.pubky,
      discovery: mocks.pubky,
      localIdentities: mocks.localIdentities,
      passportOrigin: "https://passport.example",
    });
    expect(mocks.EstablishGoogleBackedIdentity).toHaveBeenCalledWith({
      wrappingKeys: mocks.wrappingKeys,
      passportFilesForAccessToken: expect.any(Function),
      restoreExistingIdentity: mocks.restoreExistingIdentity,
      createMissingIdentity: mocks.createMissingIdentity,
    });
    expect(mocks.DeleteGoogleDriveIdentity).toHaveBeenCalledWith(expect.objectContaining({
      wrappingKeys: mocks.wrappingKeys,
      crypto: mocks.crypto,
      identityKeys: mocks.pubky,
      passportOrigin: "https://passport.example",
    }));
    expect(runtime.identityEstablisher).toBe(identityEstablisher);
    expect(runtime.identityDeleter).toBe(identityDeleter);

    runtime.dispose();
    expect(mocks.pubky.dispose).toHaveBeenCalledOnce();
  });

  it("disposes Pubky when feature construction fails", () => {
    prepareConstructors({
      identityEstablisher: { establish: vi.fn() },
      identityDeleter: { execute: vi.fn() },
    });
    mocks.CreateGoogleBackedIdentity.mockImplementationOnce(function () {
      throw new Error("construction failed");
    });

    expect(() => createGoogleBackedIdentityRuntime({
      repository: repositoryStub(),
      homegateBaseUrl: "https://homegate.example/",
      passportOrigin: "https://passport.example",
    })).toThrow("construction failed");
    expect(mocks.pubky.dispose).toHaveBeenCalledOnce();
  });
});

function prepareConstructors(input: {
  identityEstablisher: { establish: ReturnType<typeof vi.fn> };
  identityDeleter: { execute: ReturnType<typeof vi.fn> };
}): void {
  vi.clearAllMocks();
  mocks.BrowserPubky.mockImplementation(function () {
    return mocks.pubky;
  });
  mocks.WebCryptoPassportFileCrypto.mockImplementation(function () {
    return mocks.crypto;
  });
  mocks.LocalIdentityService.mockImplementation(function () {
    return mocks.localIdentities;
  });
  mocks.BrowserGoogleWrappingKeyRequester.mockImplementation(function () {
    return mocks.wrappingKeys;
  });
  mocks.BrowserGoogleHomegateInvitationRequester.mockImplementation(function () {
    return mocks.homegateInvitationRequester;
  });
  mocks.RestoreGoogleBackedIdentity.mockImplementation(function () {
    return mocks.restoreExistingIdentity;
  });
  mocks.CreateGoogleBackedIdentity.mockImplementation(function () {
    return mocks.createMissingIdentity;
  });
  mocks.EstablishGoogleBackedIdentity.mockImplementation(function () {
    return input.identityEstablisher;
  });
  mocks.DeleteGoogleDriveIdentity.mockImplementation(function () {
    return input.identityDeleter;
  });
}

function repositoryStub(): LocalIdentityRepository {
  return {} as LocalIdentityRepository;
}
