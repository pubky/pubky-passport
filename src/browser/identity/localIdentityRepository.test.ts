import { describe, expect, it } from "vitest";

import { expectAsyncResultError, expectResultError, expectResultOk } from "../../../test-utils/resultAssertions";
import { FakePubkyIdentityKeys } from "../../../test-utils/fakes/fakePubkyIdentityKeys";
import { LocalStorageIdentityRepository } from "./localIdentityRepository";

const firstIdentity = { publicKeyZ32: "firstidentity111111111111111111111111111111111111111111", publicKeyDisplay: "pubkyfirstidentity111111111111111111111111111111111111111111" };
const secondIdentity = { publicKeyZ32: "secondidentity11111111111111111111111111111111111111111", publicKeyDisplay: "pubkysecondidentity11111111111111111111111111111111111111111" };

describe("LocalStorageIdentityRepository", () => {
  it("persists identities from an existing Pubky key and selects the latest one", async () => {
    const repository = new LocalStorageIdentityRepository({ storage: new MemoryStorage() });
    const first = await save(repository, firstIdentity);
    const second = await save(repository, secondIdentity);

    expect(expectResultOk(repository.list())).toEqual({ activeIdentityId: second.id, identities: [first, second] });
  });

  it("keeps secret bytes private while restoring and verifies public metadata", async () => {
    const repository = new LocalStorageIdentityRepository({ storage: new MemoryStorage() });
    await save(repository, firstIdentity);
    const keys = new FakePubkyIdentityKeys();
    keys.nextPublicIdentity = firstIdentity;

    expectResultOk(await repository.restoreActiveIdentity({ identityKeys: keys }));
  });

  it("disposes a key when persisted metadata does not match", async () => {
    const repository = new LocalStorageIdentityRepository({ storage: new MemoryStorage() });
    await save(repository, { ...firstIdentity, publicKeyDisplay: "pubkywrong" });
    const keys = new FakePubkyIdentityKeys();

    await expectAsyncResultError(repository.restoreActiveIdentity({ identityKeys: keys }), { code: "identity_mismatch" });
    expect(keys.disposedKeys).toHaveLength(1);
  });

  it("rejects malformed persisted values", () => {
    const storage = new MemoryStorage();
    storage.setItem("pubky-passport/local-identities/v1", '{"v":1,"identities":"secret"}');
    expectResultError(new LocalStorageIdentityRepository({ storage }).list(), { code: "invalid_store" });
  });
});

async function save(repository: LocalStorageIdentityRepository, publicIdentity: typeof firstIdentity) {
  const keys = new FakePubkyIdentityKeys();
  keys.nextPublicIdentity = publicIdentity;
  const key = expectResultOk(await keys.createIdentityKey());
  return expectResultOk(await repository.saveIdentity({ identityKeys: keys, keyHandle: key.keyHandle }));
}

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();
  get length(): number { return this.#values.size; }
  clear(): void { this.#values.clear(); }
  getItem(key: string): string | null { return this.#values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.#values.keys())[index] ?? null; }
  removeItem(key: string): void { this.#values.delete(key); }
  setItem(key: string, value: string): void { this.#values.set(key, value); }
}
