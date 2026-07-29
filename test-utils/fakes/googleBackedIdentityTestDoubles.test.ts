import { describe, expect, it } from "vitest";

import {
  TEST_PASSPORT_ENVELOPE,
  TEST_PASSPORT_REFERENCE,
  RecordingPassportFileCrypto,
  SanitizedPassportFileStore,
} from "./googleBackedIdentityTestDoubles";

describe("Google-backed identity test doubles", () => {
  it("exposes only safe metadata through serializable call records", async () => {
    const fileStore = new SanitizedPassportFileStore({ status: "missing" });
    const crypto = new RecordingPassportFileCrypto();
    const secretKeyBytes = new Uint8Array(32).fill(93);

    await fileStore.createPassportFile({ envelope: TEST_PASSPORT_ENVELOPE });
    await fileStore.deletePassportFile({ reference: TEST_PASSPORT_REFERENCE });
    await crypto.encryptSecretKeyBytes({
      secretKeyBytes,
      wrappingKey: "SYNTHETIC-WRAPPING-MATERIAL",
      passportOrigin: "https://passport.pubky.app",
    });
    const publicRecords = JSON.stringify({ fileStore, crypto });
    expect(publicRecords).not.toContain(TEST_PASSPORT_ENVELOPE.iv);
    expect(publicRecords).not.toContain(TEST_PASSPORT_ENVELOPE.ct);
    expect(publicRecords).not.toContain("SYNTHETIC-WRAPPING-MATERIAL");
    expect(publicRecords).not.toContain("93,93,93");
    expect(publicRecords).not.toContain(TEST_PASSPORT_REFERENCE.storageId);
    expect(publicRecords).not.toContain(TEST_PASSPORT_REFERENCE.revision);
  });
});
