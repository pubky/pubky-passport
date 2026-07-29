import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { RecordingPubkyIdentityKeys } from "../../../../../test-utils/fakes/recordingPubkyIdentityKeys";
import { expectResultOk } from "../../../../../test-utils/resultAssertions";
import type { PubkySecretKeyMaterial } from "../../../pubky/application/pubkyIdentityKeys";
import type { LocalIdentitySummary } from "./localIdentity";
import type { LocalIdentityKeyStore } from "./localIdentityRepository";
import { SaveLocalIdentity } from "./saveLocalIdentity";

describe("SaveLocalIdentity", () => {
  it("exports, persists, and zeros secret bytes when saving", async () => {
    const keys = new RecordingPubkyIdentityKeys();
    const key = expectResultOk(await keys.createIdentityKey());
    const keyStore = new RecordingLocalIdentityKeyStore();
    const saveLocalIdentity = new SaveLocalIdentity({ keyStore, identityKeys: keys });

    expectResultOk(await saveLocalIdentity.saveIdentity({ keyHandle: key.keyHandle }));

    expect(keyStore.savedSecret?.every((byte) => byte === 0)).toBe(true);
    expect(keyStore.savedIdentity).toEqual({ id: key.publicIdentity.publicKeyZ32, publicIdentity: key.publicIdentity });
  });
});

class RecordingLocalIdentityKeyStore implements LocalIdentityKeyStore {
  savedIdentity?: LocalIdentitySummary;
  savedSecret?: Uint8Array;

  save(input: { identity: LocalIdentitySummary; secretKey: PubkySecretKeyMaterial }) {
    this.savedIdentity = input.identity;
    this.savedSecret = input.secretKey.bytes;
    return Result.ok(input.identity);
  }
  readActive() { return Result.err({ code: "no_active_identity" as const }); }
}
