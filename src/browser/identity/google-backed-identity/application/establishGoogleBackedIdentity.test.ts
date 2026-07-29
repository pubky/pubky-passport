import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import {
  fakeGoogleIdentitySession,
  fakePassportEnvelope,
  fakePassportReference,
  fakeSignupInvitation,
  FakeGoogleSignupInvitationRequester,
  FakePassportFileStore,
} from "../../../../../test-utils/fakes/googleBackedIdentityFakes";
import { expectResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import type {
  GoogleBackedIdentityCreator,
  GoogleBackedIdentityRestorer,
} from "./googleBackedIdentity";
import { EstablishGoogleBackedIdentity } from "./establishGoogleBackedIdentity";

const publicIdentity = {
  publicKeyZ32: "public-identity",
  publicKeyDisplay: "pubkypublic-identity",
};

describe("EstablishGoogleBackedIdentity", () => {
  it("routes a found Drive identity to restoration without requesting Homegate", async () => {
    const fileStore = new FakePassportFileStore({
      status: "found",
      envelope: fakePassportEnvelope,
      reference: fakePassportReference,
    });
    const restoreExistingIdentity = restorer();
    const createMissingIdentity = creator();
    const homegate = new FakeGoogleSignupInvitationRequester();
    const subject = createSubject({ fileStore, restoreExistingIdentity, createMissingIdentity, homegate });

    const result = await subject.establish(fakeGoogleIdentitySession);

    expectResultOk(result);
    expect(restoreExistingIdentity.execute).toHaveBeenCalledWith({
      envelope: fakePassportEnvelope,
      wrappingKey: "w".repeat(43),
    });
    expect(createMissingIdentity.execute).not.toHaveBeenCalled();
    expect(homegate.calls).toEqual([]);
  });

  it("requests Homegate before routing a missing Drive identity to creation", async () => {
    const events: string[] = [];
    const fileStore = new FakePassportFileStore({ status: "missing" });
    const homegate = new FakeGoogleSignupInvitationRequester(() => events.push("homegate"));
    const createMissingIdentity = creator(async () => {
      events.push("create");
      return Result.ok({ source: "created", publicIdentity });
    });
    const subject = createSubject({ fileStore, createMissingIdentity, homegate });

    const result = await subject.establish(fakeGoogleIdentitySession);

    expectResultOk(result);
    expect(homegate.calls).toEqual([{ hasGoogleIdToken: true }]);
    expect(createMissingIdentity.execute).toHaveBeenCalledWith({
      invitation: fakeSignupInvitation,
      passportFileStore: fileStore,
      wrappingKey: "w".repeat(43),
    });
    expect(events).toEqual(["homegate", "create"]);
  });

  it("stops before creation when Homegate fails", async () => {
    const homegate = new FakeGoogleSignupInvitationRequester();
    homegate.failure = "homegate_unavailable";
    const createMissingIdentity = creator();
    const subject = createSubject({
      fileStore: new FakePassportFileStore({ status: "missing" }),
      createMissingIdentity,
      homegate,
    });

    const result = await subject.establish(fakeGoogleIdentitySession);

    expectResultError(result, {
      code: "homegate_invite_failed",
      cause: "homegate_unavailable",
    });
    expect(createMissingIdentity.execute).not.toHaveBeenCalled();
  });

  it("maps wrapping-key and Drive read failures at the coordinator boundary", async () => {
    const wrappingFailure = createSubject({ wrappingFailure: true });
    expectResultError(await wrappingFailure.establish(fakeGoogleIdentitySession), {
      code: "wrapping_key_failed",
    });

    const readFailure = createSubject({
      fileStore: new FakePassportFileStore({ code: "network_failed" }),
    });
    expectResultError(await readFailure.establish(fakeGoogleIdentitySession), {
      code: "drive_read_failed",
    });
  });

  it.each(["restore", "create", "homegate"] as const)(
    "maps an unexpected %s exception without exposing dependency details",
    async (stage) => {
      const fileStore = new FakePassportFileStore(stage === "restore"
        ? { status: "found", envelope: fakePassportEnvelope, reference: fakePassportReference }
        : { status: "missing" });
      const restoreExistingIdentity = restorer(async () => { throw new Error("restore secret"); });
      const createMissingIdentity = creator(async () => { throw new Error("create secret"); });
      const homegate = new FakeGoogleSignupInvitationRequester();
      if (stage === "homegate") {
        homegate.requestGoogleSignupInvitation = async () => { throw new Error("Homegate secret"); };
      }
      const subject = createSubject({ fileStore, restoreExistingIdentity, createMissingIdentity, homegate });

      const result = await subject.establish(fakeGoogleIdentitySession);

      expectResultError(result, { code: "unexpected_failure" });
    },
  );
});

function createSubject(input: {
  fileStore?: FakePassportFileStore;
  restoreExistingIdentity?: GoogleBackedIdentityRestorer;
  createMissingIdentity?: GoogleBackedIdentityCreator;
  homegate?: FakeGoogleSignupInvitationRequester;
  wrappingFailure?: boolean;
} = {}): EstablishGoogleBackedIdentity {
  const fileStore = input.fileStore ?? new FakePassportFileStore({ status: "missing" });

  return new EstablishGoogleBackedIdentity({
    wrappingKeys: {
      async requestWrappingKey() {
        return input.wrappingFailure
          ? Result.err({ code: "network_failed" as const })
          : Result.ok("w".repeat(43));
      },
    },
    passportFileStoreForAccessToken(accessToken) {
      expect(accessToken).toBe("drive-token");
      return fileStore;
    },
    homegate: input.homegate ?? new FakeGoogleSignupInvitationRequester(),
    restoreExistingIdentity: input.restoreExistingIdentity ?? restorer(),
    createMissingIdentity: input.createMissingIdentity ?? creator(),
  });
}

function restorer(
  implementation = async () => Result.ok({ source: "restored" as const, publicIdentity }),
): GoogleBackedIdentityRestorer {
  return { execute: vi.fn(implementation) };
}

function creator(
  implementation = async () => Result.ok({ source: "created" as const, publicIdentity }),
): GoogleBackedIdentityCreator {
  return { execute: vi.fn(implementation) };
}
