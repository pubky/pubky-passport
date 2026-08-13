import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../../../test-utils/fakes/memoryStorage";
import { RecordingPubkySdkAdapter } from "../../../../../test-utils/fakes/recordingPubkySdkAdapter";
import { expectResultOk } from "../../../../../test-utils/resultAssertions";
import { LocalStorageIdentityRepository, type LocalIdentityMetadata } from "./localStorageIdentityRepository";
import { SaveLocalIdentity } from "./saveLocalIdentity";

describe("SaveLocalIdentity", () => {
  it("exports, persists, and zeros secret bytes when saving", async () => {
    const pubky = new RecordingPubkySdkAdapter();
    const key = expectResultOk(await pubky.createIdentityKey());
    let savedIdentity: LocalIdentityMetadata | undefined;
    let savedSecret: Uint8Array | undefined;
    const repository = new LocalStorageIdentityRepository(new MemoryStorage());
    vi.spyOn(repository, "save").mockImplementation((identity, secretKey) => {
      savedIdentity = identity;
      savedSecret = secretKey.bytes;
      return Result.ok(identity);
    });
    const saveLocalIdentity = new SaveLocalIdentity(
      repository,
      pubky,
    );

    expectResultOk(await saveLocalIdentity.saveIdentity(key.keyHandle));

    expect(savedSecret?.every((byte) => byte === 0)).toBe(true);
    expect(savedIdentity).toEqual({ id: key.publicIdentity.publicKeyZ32, publicIdentity: key.publicIdentity });
  });
});
