import { describe, expect, it } from "vitest";

import {
  fakePassportEnvelope,
  fakePassportReference,
  FakePassportCrypto,
  FakePassportFileStore,
} from "./googleBackedIdentityFakes";

describe("Google-backed identity fakes", () => {
  it("exposes only safe metadata through serializable call records", async () => {
    const fileStore = new FakePassportFileStore({ status: "missing" });
    const crypto = new FakePassportCrypto();
    const secretKeyBytes = new Uint8Array(32).fill(93);

    await fileStore.createPassportFile({ envelope: fakePassportEnvelope });
    await fileStore.deletePassportFile({ reference: fakePassportReference });
    await crypto.encryptSecretKeyBytes({
      secretKeyBytes,
      wrappingKey: "SYNTHETIC-WRAPPING-MATERIAL",
      passportOrigin: "https://passport.pubky.app",
    });
    const publicRecords = JSON.stringify({ fileStore, crypto });
    expect(publicRecords).not.toContain(fakePassportEnvelope.iv);
    expect(publicRecords).not.toContain(fakePassportEnvelope.ct);
    expect(publicRecords).not.toContain("SYNTHETIC-WRAPPING-MATERIAL");
    expect(publicRecords).not.toContain("93,93,93");
    expect(publicRecords).not.toContain(fakePassportReference.storageId);
    expect(publicRecords).not.toContain(fakePassportReference.revision);
  });
});
