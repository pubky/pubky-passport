import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { RecordingPubkyIdentityKeys } from "../../../../../test-utils/fakes/recordingPubkyIdentityKeys";
import {
  TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
  TEST_PASSPORT_ENVELOPE,
  TEST_PASSPORT_REFERENCE,
  RecordingPassportFileCrypto,
  SanitizedPassportFileStore,
} from "../../../../../test-utils/fakes/googleBackedIdentityTestDoubles";
import { expectResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import { DeleteGoogleDrivePassportFile } from "./deleteGoogleDrivePassportFile";

describe("DeleteGoogleDrivePassportFile", () => {
  it("deletes the exact Drive Passport file reference only when it matches the selected identity", async () => {
    const setup = createSetup();

    const result = await setup.subject.deleteGoogleDrivePassportFile(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      setup.keys.nextPublicIdentity.publicKeyZ32,
    );

    expectResultOk(result);
    expect(setup.fileStore.deleteCalls).toBe(1);
    expect(setup.fileStore.deletedExpectedReferences).toEqual([true]);
    expect(setup.keys.disposedKeys).toHaveLength(1);
    expect(setup.crypto.decryptedOutputIsZeroed()).toBe(true);
  });

  it("treats an already missing Drive Passport file as idempotent deletion", async () => {
    const setup = createSetup(new SanitizedPassportFileStore({ status: "missing" }));

    const result = await setup.subject.deleteGoogleDrivePassportFile(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      setup.keys.nextPublicIdentity.publicKeyZ32,
    );

    expectResultOk(result);
    expect(setup.fileStore.deleteCalls).toBe(0);
    expect(setup.keys.restoreCalls).toEqual([]);
    expect(setup.keys.disposedKeys).toEqual([]);
    expect(setup.crypto.decryptCalls).toBe(0);
  });

  it("does not delete a Drive Passport file that differs from the selected identity", async () => {
    const setup = createSetup();

    const result = await setup.subject.deleteGoogleDrivePassportFile(TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS, "different-local-identity");

    expectResultError(result, { code: "identity_mismatch" });
    expect(setup.fileStore.deleteCalls).toBe(0);
  });

  it("maps stale deletion and still disposes and zeroes restored key material", async () => {
    const setup = createSetup();
    setup.fileStore.deleteFailure = "stale_file";

    const result = await setup.subject.deleteGoogleDrivePassportFile(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      setup.keys.nextPublicIdentity.publicKeyZ32,
    );

    expectResultError(result, { code: "drive_stale_file" });
    expect(setup.keys.disposedKeys).toHaveLength(1);
    expect(setup.crypto.decryptedOutputIsZeroed()).toBe(true);
  });

  it("maps unexpected Drive deletion exceptions and still cleans restored key material", async () => {
    const setup = createSetup();
    setup.fileStore.deletePassportFile = async () => { throw new Error("Drive deletion threw"); };

    const result = await setup.subject.deleteGoogleDrivePassportFile(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      setup.keys.nextPublicIdentity.publicKeyZ32,
    );

    expectResultError(result, { code: "unexpected_failure" });
    expect(setup.keys.disposedKeys).toHaveLength(1);
    expect(setup.crypto.decryptedOutputIsZeroed()).toBe(true);
  });

  it("preserves a successful outcome when key cleanup throws", async () => {
    const setup = createSetup();
    setup.keys.disposeIdentityKey = () => { throw new Error("cleanup failed"); };

    const result = await setup.subject.deleteGoogleDrivePassportFile(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      setup.keys.nextPublicIdentity.publicKeyZ32,
    );

    expectResultOk(result);
  });
});

function createSetup(
  fileStore = new SanitizedPassportFileStore({
    status: "found",
    envelope: TEST_PASSPORT_ENVELOPE,
    reference: TEST_PASSPORT_REFERENCE,
  }),
) {
  const keys = new RecordingPubkyIdentityKeys();
  const crypto = new RecordingPassportFileCrypto();
  const subject = new DeleteGoogleDrivePassportFile({
    wrappingKeyRequester: { async requestWrappingKey() { return Result.ok("w".repeat(43)); } },
    passportFileStoreForAccessToken(accessToken) {
      expect(accessToken).toBe("drive-token");
      return fileStore;
    },
    crypto,
    identityKeys: keys,
    passportOrigin: "https://passport.pubky.app",
  });
  return { subject, keys, crypto, fileStore };
}
