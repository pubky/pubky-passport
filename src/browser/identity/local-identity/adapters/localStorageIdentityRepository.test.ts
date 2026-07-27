import { describe, expect, it } from "vitest";

import { MemoryStorage } from "../../../../../test-utils/fakes/memoryStorage";
import { expectResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import { pubkySecretKeyFormat } from "../../../pubky/application/pubkyIdentityKeys";
import { LocalStorageIdentityRepository } from "./localStorageIdentityRepository";

const firstIdentity = { publicKeyZ32: "firstidentity111111111111111111111111111111111111111111", publicKeyDisplay: "pubkyfirstidentity111111111111111111111111111111111111111111" };
const secondIdentity = { publicKeyZ32: "secondidentity11111111111111111111111111111111111111111", publicKeyDisplay: "pubkysecondidentity11111111111111111111111111111111111111111" };

describe("LocalStorageIdentityRepository", () => {
  it("persists identities and selects the latest one", () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageIdentityRepository({ storage });
    const first = save(repository, firstIdentity, 1);
    const second = save(repository, secondIdentity, 2);

    expect(expectResultOk(repository.list())).toEqual({ activeIdentityId: second.id, identities: [first, second] });
    expect(JSON.parse(storage.getItem("pubky-passport/local-identities/v1")!)).toEqual({
      v: 1,
      activeIdentityId: second.id,
      identities: [
        { ...first, secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE" },
        { ...second, secretKey: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI" },
      ],
    });
    expect(expectResultOk(repository.readActive())).toEqual({
      identity: second,
      secretKey: { bytes: new Uint8Array(32).fill(2), format: pubkySecretKeyFormat },
    });
  });

  it("rejects malformed persisted values", () => {
    const storage = new MemoryStorage();
    storage.setItem("pubky-passport/local-identities/v1", '{"v":1,"identities":"secret"}');
    expectResultError(new LocalStorageIdentityRepository({ storage }).list(), { code: "invalid_store" });
  });

  it("reads the existing v1 localStorage format", () => {
    const storage = new MemoryStorage();
    const identity = { id: firstIdentity.publicKeyZ32, publicIdentity: firstIdentity };
    storage.setItem("pubky-passport/local-identities/v1", JSON.stringify({
      v: 1,
      activeIdentityId: identity.id,
      identities: [{ ...identity, secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE" }],
    }));
    const repository = new LocalStorageIdentityRepository({ storage });

    expect(expectResultOk(repository.list())).toEqual({ activeIdentityId: identity.id, identities: [identity] });
    expect(expectResultOk(repository.readActive())).toEqual({
      identity,
      secretKey: { bytes: new Uint8Array(32).fill(1), format: pubkySecretKeyFormat },
    });
  });

  it("clears only Passport local identities", () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageIdentityRepository({ storage });
    storage.setItem("unrelated", "keep");
    save(repository, firstIdentity, 1);

    expectResultOk(repository.clear());

    expect(expectResultOk(repository.list())).toEqual({ activeIdentityId: null, identities: [] });
    expect(storage.getItem("unrelated")).toBe("keep");
  });
});

function save(repository: LocalStorageIdentityRepository, publicIdentity: typeof firstIdentity, byte: number) {
  return expectResultOk(repository.save({
    identity: { id: publicIdentity.publicKeyZ32, publicIdentity },
    secretKey: { bytes: new Uint8Array(32).fill(byte), format: pubkySecretKeyFormat },
  }));
}
