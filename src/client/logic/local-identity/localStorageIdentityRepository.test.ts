/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../../test-utils/fakes/MemoryStorage";
import { expectResultError, expectResultOk } from "../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../libs/logger/logger";
import { PUBKY_SECRET_KEY_FORMAT, type PubkyPublicIdentity } from "../pubky/pubkyIdentityKey";
import { LocalStorageIdentityRepository } from "./LocalStorageIdentityRepository";

const FIRST_PUBLIC_KEY_Z32 = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECOND_PUBLIC_KEY_Z32 = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const FIRST_IDENTITY = { publicKeyZ32: FIRST_PUBLIC_KEY_Z32, publicKeyDisplay: `pubky${FIRST_PUBLIC_KEY_Z32}` };
const SECOND_IDENTITY = { publicKeyZ32: SECOND_PUBLIC_KEY_Z32, publicKeyDisplay: `pubky${SECOND_PUBLIC_KEY_Z32}` };

describe("LocalStorageIdentityRepository", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists identities and selects the latest one", () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageIdentityRepository(storage);
    const first = save(repository, FIRST_IDENTITY, 1);
    const second = save(repository, SECOND_IDENTITY, 2);

    const reloadedRepository = new LocalStorageIdentityRepository(storage);
    expect(expectResultOk(reloadedRepository.list())).toEqual({
      activePublicKeyZ32: second.publicIdentity.publicKeyZ32,
      identities: [first, second],
    });
    expect(JSON.parse(storage.getItem("pubky-passport/local-identities/v1")!)).toEqual({
      v: 1,
      activePublicKeyZ32: second.publicIdentity.publicKeyZ32,
      identities: [
        { ...first, secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE" },
        { ...second, secretKey: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI" },
      ],
    });
    expect(expectResultOk(reloadedRepository.readActive())).toEqual({
      identity: second,
      secretKey: { bytes: new Uint8Array(32).fill(2), format: PUBKY_SECRET_KEY_FORMAT },
    });
    expect(expectResultOk(reloadedRepository.read(first.publicIdentity.publicKeyZ32))).toEqual({
      identity: first,
      secretKey: { bytes: new Uint8Array(32).fill(1), format: PUBKY_SECRET_KEY_FORMAT },
    });
  });

  it("selects and replaces identities by their z32 public key", () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageIdentityRepository(storage);
    const first = save(repository, FIRST_IDENTITY, 1);
    const second = save(repository, SECOND_IDENTITY, 2);

    expectResultOk(repository.select(first.publicIdentity.publicKeyZ32));
    expect(expectResultOk(repository.readActive()).identity).toEqual(first);

    const replacement = expectResultOk(repository.save(
      {
        publicIdentity: FIRST_IDENTITY,
        googleAccount: {
          id: "google-1",
          email: "first@example.com",
          name: "First",
          pictureUrl: null,
        },
      },
      { bytes: new Uint8Array(32).fill(3), format: PUBKY_SECRET_KEY_FORMAT },
    ));

    expect(expectResultOk(repository.list())).toEqual({
      activePublicKeyZ32: FIRST_IDENTITY.publicKeyZ32,
      identities: [replacement, second],
    });
    expect(expectResultOk(repository.readActive()).secretKey.bytes).toEqual(new Uint8Array(32).fill(3));
  });

  it("rejects malformed persisted values", () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const storage = new MemoryStorage();
    storage.setItem("pubky-passport/local-identities/v1", '{"v":1,"identities":"secret"}');
    expectResultError(new LocalStorageIdentityRepository(storage).list(), { code: "invalid_store" });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("identity.local_store.failed", {
      operation: "read",
      code: "invalid_store",
    });
  });

  it("logs storage exceptions without exposing persisted contents", () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const storage = new MemoryStorage();
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("sensitive persisted contents");
    });

    expectResultError(new LocalStorageIdentityRepository(storage).list(), {
      code: "storage_unavailable",
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("identity.local_store.failed", {
      operation: "read",
      code: "storage_unavailable",
    });
  });

  it("reads the v1 localStorage format without a redundant identity id", () => {
    const storage = new MemoryStorage();
    const identity = { publicIdentity: FIRST_IDENTITY };
    storage.setItem("pubky-passport/local-identities/v1", JSON.stringify({
      v: 1,
      activePublicKeyZ32: identity.publicIdentity.publicKeyZ32,
      identities: [{ ...identity, secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE" }],
    }));
    const repository = new LocalStorageIdentityRepository(storage);

    expect(expectResultOk(repository.list())).toEqual({
      activePublicKeyZ32: identity.publicIdentity.publicKeyZ32,
      identities: [identity],
    });
    expect(expectResultOk(repository.readActive())).toEqual({
      identity,
      secretKey: { bytes: new Uint8Array(32).fill(1), format: PUBKY_SECRET_KEY_FORMAT },
    });
  });

  it("persists the Google account associated with an identity", () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageIdentityRepository(storage);
    const googleAccount = { id: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: "data:image/png;base64,AQID" };

    const identity = expectResultOk(repository.save(
      { publicIdentity: FIRST_IDENTITY, googleAccount },
      { bytes: new Uint8Array(32).fill(1), format: PUBKY_SECRET_KEY_FORMAT },
    ));

    expect(identity.googleAccount).toEqual(googleAccount);
    expect(expectResultOk(new LocalStorageIdentityRepository(storage).list()).identities[0]?.googleAccount).toEqual(googleAccount);
  });

  it.each([
    ["an empty account id", { id: "", email: "user@example.com", name: "User", pictureUrl: null }],
    ["a remote avatar", { id: "google-1", email: "user@example.com", name: "User", pictureUrl: "https://example.com/avatar.png" }],
    ["an undeclared account field", {
      id: "google-1",
      email: "user@example.com",
      name: "User",
      pictureUrl: null,
      driveAccessToken: "SENSITIVE-DRIVE-TOKEN",
    }],
  ])("rejects Google metadata with %s before writing", (_case, googleAccount) => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageIdentityRepository(storage);

    expectResultError(repository.save(
      { publicIdentity: FIRST_IDENTITY, googleAccount },
      { bytes: new Uint8Array(32).fill(1), format: PUBKY_SECRET_KEY_FORMAT },
    ), { code: "invalid_identity" });
    expect(storage.getItem("pubky-passport/local-identities/v1")).toBeNull();
  });

  it.each([
    ["a malformed z32 key", { ...FIRST_IDENTITY, publicKeyZ32: "not-a-pubky" }],
    ["a mismatched display key", { ...FIRST_IDENTITY, publicKeyDisplay: SECOND_IDENTITY.publicKeyDisplay }],
    ["an undeclared field", { ...FIRST_IDENTITY, unexpected: true }],
  ])("rejects a public identity with %s before writing", (_case, publicIdentity) => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageIdentityRepository(storage);

    expectResultError(repository.save(
      { publicIdentity },
      { bytes: new Uint8Array(32).fill(1), format: PUBKY_SECRET_KEY_FORMAT },
    ), { code: "invalid_identity" });
    expect(storage.getItem("pubky-passport/local-identities/v1")).toBeNull();
  });

  it("serializes only the declared public metadata fields", () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageIdentityRepository(storage);
    const identityWithToken = {
      publicIdentity: FIRST_IDENTITY,
      googleAccount: { id: "google-1", email: "user@example.com", name: "User", pictureUrl: null },
      googleIdToken: "SENSITIVE-ID-TOKEN",
      driveAccessToken: "SENSITIVE-DRIVE-TOKEN",
    };

    expectResultOk(repository.save(
      identityWithToken,
      { bytes: new Uint8Array(32).fill(1), format: PUBKY_SECRET_KEY_FORMAT },
    ));

    const stored = storage.getItem("pubky-passport/local-identities/v1");
    expect(stored).not.toContain("SENSITIVE");
  });

  it("rejects the obsolete local identity store schema", () => {
    const storage = new MemoryStorage();
    storage.setItem("pubky-passport/local-identities/v1", JSON.stringify({
      v: 1,
      activeIdentityId: FIRST_IDENTITY.publicKeyZ32,
      identities: [{
        id: FIRST_IDENTITY.publicKeyZ32,
        publicIdentity: FIRST_IDENTITY,
        secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      }],
    }));

    expectResultError(new LocalStorageIdentityRepository(storage).list(), { code: "invalid_store" });
  });

  it("rejects duplicate persisted public keys", () => {
    const storage = new MemoryStorage();
    storage.setItem("pubky-passport/local-identities/v1", JSON.stringify({
      v: 1,
      activePublicKeyZ32: FIRST_IDENTITY.publicKeyZ32,
      identities: [
        {
          publicIdentity: FIRST_IDENTITY,
          secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
        },
        {
          publicIdentity: FIRST_IDENTITY,
          secretKey: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
        },
      ],
    }));

    expectResultError(new LocalStorageIdentityRepository(storage).list(), { code: "invalid_store" });
  });

  it("removes only one identity and activates a remaining identity", () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageIdentityRepository(storage);
    const first = save(repository, FIRST_IDENTITY, 1);
    const second = save(repository, SECOND_IDENTITY, 2);

    expectResultOk(repository.remove(second.publicIdentity.publicKeyZ32));

    expect(expectResultOk(repository.list())).toEqual({
      activePublicKeyZ32: first.publicIdentity.publicKeyZ32,
      identities: [first],
    });
  });

  it("uses one last-write-wins write without read-back retries", () => {
    const storage = new MemoryStorage();
    const getItem = vi.spyOn(storage, "getItem");
    const setItem = vi.spyOn(storage, "setItem");
    const repository = new LocalStorageIdentityRepository(storage);

    save(repository, FIRST_IDENTITY, 1);

    expect(setItem).toHaveBeenCalledOnce();
    expect(getItem).toHaveBeenCalledOnce();
  });

});

function save(repository: LocalStorageIdentityRepository, publicIdentity: PubkyPublicIdentity, byte: number) {
  return expectResultOk(repository.save(
    { publicIdentity },
    { bytes: new Uint8Array(32).fill(byte), format: PUBKY_SECRET_KEY_FORMAT },
  ));
}
