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
import { DeleteGoogleIdentityBackups } from "./deleteGoogleIdentityBackups";

const PUBLIC_IDENTITY = {
  publicKeyZ32: "public-key",
  publicKeyDisplay: "pubky1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy",
};

describe("DeleteGoogleIdentityBackups", () => {
  it("deletes visible copies and the exact app-data file only when it matches the selected identity", async () => {
    const setup = createSetup();

    const result = await setup.subject.deleteGoogleIdentityBackups(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      PUBLIC_IDENTITY,
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS.googleAccount.id,
    );

    expect(expectResultOk(result)).toEqual({ status: "deleted" });
    expect(setup.fileStore.deleteCalls).toBe(1);
    expect(setup.fileStore.deletedExpectedReferences).toEqual([true]);
    expect(setup.visibleCopyDeletes).toEqual([PUBLIC_IDENTITY.publicKeyDisplay]);
    expect(setup.pubky.disposedKeys).toHaveLength(1);
    expect(setup.crypto.decryptedOutputIsZeroed()).toBe(true);
  });

  it("deletes visible copies even when the app-data Passport file is missing", async () => {
    const setup = createSetup(new RecordingPassportFileOperations({ status: "missing" }));

    const result = await setup.subject.deleteGoogleIdentityBackups(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      PUBLIC_IDENTITY,
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS.googleAccount.id,
    );

    expect(expectResultOk(result)).toEqual({ status: "missing" });
    expect(setup.fileStore.deleteCalls).toBe(0);
    expect(setup.pubky.restoreCalls).toEqual([]);
    expect(setup.pubky.disposedKeys).toEqual([]);
    expect(setup.crypto.decryptCalls).toBe(0);
    expect(setup.visibleCopyDeletes).toEqual([PUBLIC_IDENTITY.publicKeyDisplay]);
  });

  it("preserves safe wrapping-key failure details", async () => {
    const setup = createSetup(undefined, "rate_limited");

    const result = await setup.subject.deleteGoogleIdentityBackups(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      PUBLIC_IDENTITY,
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS.googleAccount.id,
    );

    expectResultError(result, { code: "wrapping_key_failed", cause: "rate_limited" });
    expect(setup.crypto.decryptCalls).toBe(0);
    expect(setup.fileStore.deleteCalls).toBe(0);
  });

  it("does not delete a Drive Passport file that differs from the selected identity", async () => {
    const setup = createSetup();

    const result = await setup.subject.deleteGoogleIdentityBackups(TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS, {
      ...PUBLIC_IDENTITY,
      publicKeyZ32: "different-local-identity",
    }, TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS.googleAccount.id);

    expectResultError(result, { code: "identity_mismatch" });
    expect(setup.fileStore.deleteCalls).toBe(0);
    expect(setup.visibleCopyDeletes).toEqual([]);
  });

  it("does not access Drive when the authorized Google account differs", async () => {
    const setup = createSetup();

    const result = await setup.subject.deleteGoogleIdentityBackups(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      PUBLIC_IDENTITY,
      "different-google-account",
    );

    expectResultError(result, { code: "identity_mismatch" });
    expect(setup.fileStore.deleteCalls).toBe(0);
    expect(setup.crypto.decryptCalls).toBe(0);
    expect(setup.visibleCopyDeletes).toEqual([]);
  });

  it("maps stale deletion and still disposes and zeroes restored key material", async () => {
    const setup = createSetup();
    setup.fileStore.deleteFailure = "stale_file";

    const result = await setup.subject.deleteGoogleIdentityBackups(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      PUBLIC_IDENTITY,
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS.googleAccount.id,
    );

    expectResultError(result, { code: "drive_stale_file" });
    expect(setup.pubky.disposedKeys).toHaveLength(1);
    expect(setup.crypto.decryptedOutputIsZeroed()).toBe(true);
  });

  it("keeps the app-data file when visible recovery cleanup fails", async () => {
    const setup = createSetup(undefined, undefined, true);

    const result = await setup.subject.deleteGoogleIdentityBackups(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      PUBLIC_IDENTITY,
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS.googleAccount.id,
    );

    expectResultError(result, { code: "drive_delete_failed" });
    expect(setup.fileStore.deleteCalls).toBe(0);
  });

  it("maps unexpected Drive deletion exceptions and still cleans restored key material", async () => {
    const setup = createSetup();
    setup.fileStore.throwOnDelete = true;

    const result = await setup.subject.deleteGoogleIdentityBackups(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      PUBLIC_IDENTITY,
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS.googleAccount.id,
    );

    expectResultError(result, { code: "unexpected_failure" });
    expect(setup.pubky.disposedKeys).toHaveLength(1);
    expect(setup.crypto.decryptedOutputIsZeroed()).toBe(true);
  });

  it("preserves a successful outcome when key cleanup throws", async () => {
    const setup = createSetup();
    setup.pubky.throwOnDisposeIdentity = true;

    const result = await setup.subject.deleteGoogleIdentityBackups(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      PUBLIC_IDENTITY,
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS.googleAccount.id,
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
  visibleDeleteFailure = false,
) {
  const pubky = new RecordingPubkySdkAdapter();
  pubky.nextPublicIdentity = PUBLIC_IDENTITY;
  const crypto = new RecordingPassportFileCrypto();
  const wrappingKeyRequest = sanitizedWrappingKeyRequest(wrappingFailure);
  const visibleCopyDeletes: string[] = [];
  const subject = new DeleteGoogleIdentityBackups({
    requestWrappingKey: wrappingKeyRequest.request,
    readPassportFile: fileStore.readPassportFile.bind(fileStore),
    deletePassportFileByReference: fileStore.deletePassportFile.bind(fileStore),
    deleteVisibleRecoveryCopies: async (_token, publicKeyDisplay) => {
      visibleCopyDeletes.push(publicKeyDisplay);
      return visibleDeleteFailure
        ? Result.err({ code: "forbidden" as const })
        : Result.ok({ deletedCount: 2 });
    },
    decryptSecretKeyBytes: crypto.decryptSecretKeyBytes.bind(crypto),
    pubky,
    passportOrigin: "https://passport.pubky.app",
  });
  return { subject, pubky, crypto, fileStore, visibleCopyDeletes };
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
