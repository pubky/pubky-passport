import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { RecordingPubkySdkAdapter } from "../../../../test-utils/fakes/recordingPubkySdkAdapter";
import {
  TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
  TEST_PASSPORT_ENVELOPE,
  TEST_PASSPORT_REFERENCE,
  RecordingPassportFileCrypto,
  RecordingPassportFileOperations,
} from "../../../../test-utils/fakes/googleBackedIdentityTestDoubles";
import { expectResultError, expectResultOk } from "../../../../test-utils/resultAssertions";
import { DeleteGoogleDrivePassportFile } from "./deleteGoogleDrivePassportFile";

describe("DeleteGoogleDrivePassportFile", () => {
  it("deletes the exact Drive Passport file reference only when it matches the selected identity", async () => {
    const setup = createSetup();

    const result = await setup.subject.deleteGoogleDrivePassportFile(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
       setup.pubky.nextPublicIdentity.publicKeyZ32,
    );

    expectResultOk(result);
    expect(setup.fileStore.deleteCalls).toBe(1);
    expect(setup.fileStore.deletedExpectedReferences).toEqual([true]);
    expect(setup.pubky.disposedKeys).toHaveLength(1);
    expect(setup.crypto.decryptedOutputIsZeroed()).toBe(true);
  });

  it("treats an already missing Drive Passport file as idempotent deletion", async () => {
    const setup = createSetup(new RecordingPassportFileOperations({ status: "missing" }));

    const result = await setup.subject.deleteGoogleDrivePassportFile(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      setup.pubky.nextPublicIdentity.publicKeyZ32,
    );

    expectResultOk(result);
    expect(setup.fileStore.deleteCalls).toBe(0);
    expect(setup.pubky.restoreCalls).toEqual([]);
    expect(setup.pubky.disposedKeys).toEqual([]);
    expect(setup.crypto.decryptCalls).toBe(0);
  });

  it("preserves safe wrapping-key failure details", async () => {
    const setup = createSetup(undefined, "rate_limited");

    const result = await setup.subject.deleteGoogleDrivePassportFile(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      setup.pubky.nextPublicIdentity.publicKeyZ32,
    );

    expectResultError(result, { code: "wrapping_key_failed", cause: "rate_limited" });
    expect(setup.crypto.decryptCalls).toBe(0);
    expect(setup.fileStore.deleteCalls).toBe(0);
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
      setup.pubky.nextPublicIdentity.publicKeyZ32,
    );

    expectResultError(result, { code: "drive_stale_file" });
    expect(setup.pubky.disposedKeys).toHaveLength(1);
    expect(setup.crypto.decryptedOutputIsZeroed()).toBe(true);
  });

  it("maps unexpected Drive deletion exceptions and still cleans restored key material", async () => {
    const setup = createSetup();
    setup.fileStore.throwOnDelete = true;

    const result = await setup.subject.deleteGoogleDrivePassportFile(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      setup.pubky.nextPublicIdentity.publicKeyZ32,
    );

    expectResultError(result, { code: "unexpected_failure" });
    expect(setup.pubky.disposedKeys).toHaveLength(1);
    expect(setup.crypto.decryptedOutputIsZeroed()).toBe(true);
  });

  it("preserves a successful outcome when key cleanup throws", async () => {
    const setup = createSetup();
    setup.pubky.throwOnDisposeIdentity = true;

    const result = await setup.subject.deleteGoogleDrivePassportFile(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      setup.pubky.nextPublicIdentity.publicKeyZ32,
    );

    expectResultOk(result);
  });
});

function createSetup(
  fileStore = new RecordingPassportFileOperations({
    status: "found",
    envelope: TEST_PASSPORT_ENVELOPE,
    reference: TEST_PASSPORT_REFERENCE,
  }),
  wrappingFailure?: "rate_limited",
) {
  const pubky = new RecordingPubkySdkAdapter();
  const crypto = new RecordingPassportFileCrypto();
  const wrappingKeyRequest = sanitizedWrappingKeyRequest(wrappingFailure);
  const subject = new DeleteGoogleDrivePassportFile({
    requestWrappingKey: wrappingKeyRequest.request,
    readPassportFile: fileStore.readPassportFile.bind(fileStore),
    deletePassportFileByReference: fileStore.deletePassportFile.bind(fileStore),
    decryptSecretKeyBytes: crypto.decryptSecretKeyBytes.bind(crypto),
    pubky,
    passportOrigin: "https://passport.pubky.app",
  });
  return { subject, pubky, crypto, fileStore };
}

function sanitizedWrappingKeyRequest(failure?: "rate_limited") {
  const calls = { count: 0, hasGoogleIdToken: false };
  return {
    calls,
    async request(googleIdToken: string) {
      calls.count += 1;
      calls.hasGoogleIdToken = googleIdToken.trim().length > 0;
      return failure ? Result.err({ code: failure }) : Result.ok("w".repeat(43));
    },
  };
}
