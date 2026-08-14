import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import {
  TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
  TEST_PASSPORT_ENVELOPE,
  TEST_PASSPORT_REFERENCE,
  TEST_SIGNUP_INVITATION,
} from "../../../../../test-utils/fakes/googleBackedIdentityTestDoubles";
import { expectResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../../libs/logger/logger";
import {
  EstablishGoogleBackedIdentity,
} from "./establishGoogleBackedIdentity";
import type { ReportCreateGoogleBackedIdentityProgress } from "./createGoogleBackedIdentity";
import type { ReportRestoreGoogleBackedIdentityProgress } from "./restoreGoogleBackedIdentity";

const PUBLIC_IDENTITY = {
  publicKeyZ32: "public-identity",
  publicKeyDisplay: "pubkypublic-identity",
};

describe("EstablishGoogleBackedIdentity", () => {
  it("restores a found Passport file", async () => {
    const setup = createSetup({ fileStatus: "found" });
    const progress: string[] = [];

    expectResultOk(await setup.subject.execute(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      (phase) => progress.push(phase),
    ));

    expect(setup.calls.restore).toBe(1);
    expect(setup.calls.create).toBe(0);
    expect(setup.calls.homegate).toBe(0);
    expect(progress).toEqual([
      "preparing_secure_identity",
      "checking_passport_file",
      "restoring_identity",
      "activating_restored_identity",
    ]);
  });

  it("requests an invitation before creating a missing identity", async () => {
    const setup = createSetup({ fileStatus: "missing" });
    const progress: string[] = [];

    expectResultOk(await setup.subject.execute(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      (phase) => progress.push(phase),
    ));

    expect(setup.calls.events).toEqual(["homegate", "create"]);
    expect(setup.calls.create).toBe(1);
    expect(setup.calls.restore).toBe(0);
    expect(setup.calls.createdOperationalFile).toBe(true);
    expect(setup.calls.createdVisibleCopy).toBe(true);
    expect(progress).toEqual([
      "preparing_secure_identity",
      "checking_passport_file",
      "preparing_new_identity",
      "creating_identity",
      "storing_encrypted_identity",
      "signing_up_to_homeserver",
      "publishing_discovery",
      "activating_created_identity",
    ]);
  });

  it("stops before creation when invitation acquisition fails", async () => {
    const setup = createSetup({ fileStatus: "missing", homegateFailure: true });
    const progress: string[] = [];

    expectResultError(
      await setup.subject.execute(
        TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
        (phase) => progress.push(phase),
      ),
      { code: "homeserver_signup_invitation_failed", cause: "homegate_unavailable" },
    );
    expect(setup.calls.create).toBe(0);
    expect(progress).toEqual([
      "preparing_secure_identity",
      "checking_passport_file",
      "preparing_new_identity",
    ]);
  });

  it("maps wrapping-key and Drive read failures", async () => {
    const wrapping = createSetup({ wrappingFailure: true });
    const wrappingProgress: string[] = [];
    expectResultError(
      await wrapping.subject.execute(
        TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
        (phase) => wrappingProgress.push(phase),
      ),
      { code: "wrapping_key_failed", cause: "network_failed" },
    );
    expect(wrappingProgress).toEqual(["preparing_secure_identity"]);

    const read = createSetup({ readFailure: true });
    const readProgress: string[] = [];
    expectResultError(
      await read.subject.execute(
        TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
        (phase) => readProgress.push(phase),
      ),
      { code: "drive_read_failed" },
    );
    expect(readProgress).toEqual(["preparing_secure_identity", "checking_passport_file"]);
  });

  it("contains progress listener failures without interrupting establishment", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const setup = createSetup({ fileStatus: "found" });

    expectResultOk(await setup.subject.execute(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      () => { throw new Error("SECRET-PROGRESS-LISTENER"); },
    ));

    expect(warning).toHaveBeenCalledWith("identity.google.progress_listener.failed");
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-PROGRESS-LISTENER");
  });

  it.each(["restore", "create", "homegate"] as const)(
    "maps an unexpected %s exception without exposing dependency details",
    async (stage) => {
      const setup = createSetup({
        fileStatus: stage === "restore" ? "found" : "missing",
        throwStage: stage,
      });

      expectResultError(
        await setup.subject.execute(TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS, () => undefined),
        { code: "unexpected_failure" },
      );
    },
  );
});

function createSetup(input: {
  fileStatus?: "found" | "missing";
  wrappingFailure?: boolean;
  readFailure?: boolean;
  homegateFailure?: boolean;
  throwStage?: "restore" | "create" | "homegate";
} = {}) {
  const calls = {
    create: 0,
    restore: 0,
    homegate: 0,
    events: [] as string[],
    createdOperationalFile: false,
    createdVisibleCopy: false,
  };
  const reportRestore = (
    reportProgress: ReportRestoreGoogleBackedIdentityProgress,
  ): void => {
    reportProgress("restoring_identity");
    reportProgress("activating_restored_identity");
  };
  const reportCreate = (
    reportProgress: ReportCreateGoogleBackedIdentityProgress,
  ): void => {
    reportProgress("storing_encrypted_identity");
    reportProgress("signing_up_to_homeserver");
    reportProgress("publishing_discovery");
    reportProgress("activating_created_identity");
  };
  const subject = new EstablishGoogleBackedIdentity({
    requestWrappingKey: async () => input.wrappingFailure
      ? Result.err({ code: "network_failed" as const })
      : Result.ok("w".repeat(43)),
    readPassportFile: async () => input.readFailure
      ? Result.err({ code: "network_failed" as const })
      : input.fileStatus === "missing"
        ? Result.ok({ status: "missing" as const })
        : Result.ok({
          status: "found" as const,
          envelope: TEST_PASSPORT_ENVELOPE,
          reference: TEST_PASSPORT_REFERENCE,
        }),
    requestSignupInvitation: async () => {
      calls.events.push("homegate");
      calls.homegate += 1;
      if (input.throwStage === "homegate") throw new Error("Homegate secret");
      return input.homegateFailure
        ? Result.err({ code: "homegate_unavailable" as const })
        : Result.ok(TEST_SIGNUP_INVITATION);
    },
    createPassportFile: async (_token, envelope) => {
      calls.createdOperationalFile = envelope === TEST_PASSPORT_ENVELOPE;
      return Result.ok();
    },
    createVisibleRecoveryCopy: async (_token, envelope, publicKeyDisplay, signal) => {
      calls.createdVisibleCopy = envelope === TEST_PASSPORT_ENVELOPE
        && publicKeyDisplay === PUBLIC_IDENTITY.publicKeyDisplay
        && signal instanceof AbortSignal;
      return Result.ok();
    },
    restoreIdentity: async (_envelope, _wrappingKey, reportProgress) => {
      calls.restore += 1;
      if (input.throwStage === "restore") throw new Error("restore secret");
      reportRestore(reportProgress);
      return Result.ok({ establishmentMode: "restored" as const, publicIdentity: PUBLIC_IDENTITY });
    },
    createIdentity: async (
      _invitation,
      createPassportFile,
      createVisibleRecoveryCopy,
      _wrappingKey,
      reportProgress,
    ) => {
      calls.events.push("create");
      calls.create += 1;
      if (input.throwStage === "create") throw new Error("create secret");
      await createPassportFile(TEST_PASSPORT_ENVELOPE);
      await createVisibleRecoveryCopy(
        TEST_PASSPORT_ENVELOPE,
        PUBLIC_IDENTITY.publicKeyDisplay,
        new AbortController().signal,
      );
      reportCreate(reportProgress);
      return Result.ok({
        establishmentMode: "created" as const,
        publicIdentity: PUBLIC_IDENTITY,
        visibleRecoveryCopyStatus: "created" as const,
      });
    },
  });
  return { subject, calls };
}
