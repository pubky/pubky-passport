import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS } from "../../../../../test-utils/fakes/googleBackedIdentityTestDoubles";
import { expectResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import { DetachGoogleBackedIdentity } from "./detachGoogleBackedIdentity";

const PUBLIC_IDENTITY = {
  publicKeyZ32: "public-identity",
  publicKeyDisplay: "pubkypublic-identity",
};

describe("DetachGoogleBackedIdentity", () => {
  it("deletes verified backups before removing the local identity", async () => {
    const events: string[] = [];
    const subject = new DetachGoogleBackedIdentity(
      async () => {
        events.push("delete");
        return Result.ok({ status: "deleted" as const });
      },
      () => {
        events.push("remove");
        return Result.ok();
      },
    );

    expect(expectResultOk(await subject.execute(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      PUBLIC_IDENTITY,
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS.googleAccount.id,
    ))).toEqual({ deletionStatus: "deleted" });
    expect(events).toEqual(["delete", "remove"]);
  });

  it("keeps the local identity when backup deletion fails", async () => {
    let removeCalled = false;
    const subject = new DetachGoogleBackedIdentity(
      async () => Result.err({ code: "drive_delete_failed" as const }),
      () => {
        removeCalled = true;
        return Result.ok();
      },
    );

    expectResultError(await subject.execute(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      PUBLIC_IDENTITY,
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS.googleAccount.id,
    ), { code: "backup_deletion_failed" });
    expect(removeCalled).toBe(false);
  });

  it("maps local removal failures", async () => {
    const subject = new DetachGoogleBackedIdentity(
      async () => Result.ok({ status: "missing" as const }),
      () => Result.err({ code: "storage_unavailable" as const }),
    );

    expectResultError(await subject.execute(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      PUBLIC_IDENTITY,
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS.googleAccount.id,
    ), { code: "local_remove_failed" });
  });
});
