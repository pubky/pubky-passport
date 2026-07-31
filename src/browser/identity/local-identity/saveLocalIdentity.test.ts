import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { RecordingPubkySdkAdapter } from "../../../../test-utils/fakes/recordingPubkySdkAdapter";
import { expectResultOk } from "../../../../test-utils/resultAssertions";
import type { LocalIdentitySummary } from "./localStorageIdentityRepository";
import { SaveLocalIdentity } from "./saveLocalIdentity";

describe("SaveLocalIdentity", () => {
  it("exports, persists, and zeros secret bytes when saving", async () => {
    const pubky = new RecordingPubkySdkAdapter();
    const key = expectResultOk(await pubky.createIdentityKey());
    let savedIdentity: LocalIdentitySummary | undefined;
    let savedSecret: Uint8Array | undefined;
    const saveLocalIdentity = new SaveLocalIdentity({
      saveIdentityRecord: (identity, secretKey) => {
        savedIdentity = identity;
        savedSecret = secretKey.bytes;
        return Result.ok(identity);
      },
      pubky,
    });

    expectResultOk(await saveLocalIdentity.saveIdentity(key.keyHandle));

    expect(savedSecret?.every((byte) => byte === 0)).toBe(true);
    expect(savedIdentity).toEqual({ id: key.publicIdentity.publicKeyZ32, publicIdentity: key.publicIdentity });
  });
});
