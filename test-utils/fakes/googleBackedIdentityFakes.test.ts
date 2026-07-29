import { describe, expect, it } from "vitest";

import {
  FAKE_PASSPORT_ENVELOPE,
  FAKE_PASSPORT_REFERENCE,
  FakePassportCrypto,
  FakePassportFileStore,
} from "./googleBackedIdentityFakes";

describe("Google-backed identity fakes", () => {
  it("exposes only safe metadata through serializable call records", async () => {
    const fileStore = new FakePassportFileStore({ status: "missing" });
    const crypto = new FakePassportCrypto();
    const secretKeyBytes = new Uint8Array(32).fill(93);

    await fileStore.createPassportFile({ envelope: FAKE_PASSPORT_ENVELOPE });
    await fileStore.deletePassportFile({ reference: FAKE_PASSPORT_REFERENCE });
    await crypto.encryptSecretKeyBytes({
      secretKeyBytes,
      wrappingKey: "SYNTHETIC-WRAPPING-MATERIAL",
      passportOrigin: "https://passport.pubky.app",
    });
    const publicRecords = JSON.stringify({ fileStore, crypto });
    expect(publicRecords).not.toContain(FAKE_PASSPORT_ENVELOPE.iv);
    expect(publicRecords).not.toContain(FAKE_PASSPORT_ENVELOPE.ct);
    expect(publicRecords).not.toContain("SYNTHETIC-WRAPPING-MATERIAL");
    expect(publicRecords).not.toContain("93,93,93");
    expect(publicRecords).not.toContain(FAKE_PASSPORT_REFERENCE.storageId);
    expect(publicRecords).not.toContain(FAKE_PASSPORT_REFERENCE.revision);
  });
});
