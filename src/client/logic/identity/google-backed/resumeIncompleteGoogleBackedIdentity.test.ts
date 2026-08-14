import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { RecordingPubkySdkAdapter } from "../../../../../test-utils/fakes/recordingPubkySdkAdapter";
import {
  TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
  TEST_PASSPORT_ENVELOPE,
  TEST_PASSPORT_REFERENCE,
  TEST_SIGNUP_INVITATION,
} from "../../../../../test-utils/fakes/googleBackedIdentityTestDoubles";
import { expectResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import { ResumeIncompleteGoogleBackedIdentity } from "./resumeIncompleteGoogleBackedIdentity";

describe("ResumeIncompleteGoogleBackedIdentity", () => {
  it("restores the existing key before obtaining an invitation and activating it", async () => {
    const setup = await createSetup();
    const progress: string[] = [];

    expect(expectResultOk(await setup.subject.execute(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      setup.identity.publicIdentity,
      (phase) => progress.push(phase),
    ))).toEqual({
      establishmentMode: "restored",
      publicIdentity: setup.identity.publicIdentity,
    });

    expect(setup.events).toEqual(["wrapping-key", "drive-read", "restore-key", "homegate", "activate"]);
    expect(progress).toEqual([
      "preparing_secure_identity",
      "checking_passport_file",
      "restoring_identity",
      "signing_up_to_homeserver",
      "publishing_discovery",
      "activating_created_identity",
    ]);
    expect(setup.pubky.createCalls).toBe(1);
    expect(setup.pubky.disposedKeys).toEqual([setup.identity.keyHandle]);
  });

  it("does not request an invitation when the stored key is not the expected Pubky", async () => {
    const setup = await createSetup();
    const expectedIdentity = {
      publicKeyZ32: "different-public-identity",
      publicKeyDisplay: "pubkydifferent-public-identity",
    };

    expectResultError(await setup.subject.execute(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      expectedIdentity,
      () => undefined,
    ), {
      code: "identity_mismatch",
      preservedPassportFileIdentity: expectedIdentity,
    });
    expect(setup.events).toEqual(["wrapping-key", "drive-read", "restore-key"]);
    expect(setup.pubky.disposedKeys).toEqual([setup.identity.keyHandle]);
  });

  it("preserves the same identity when fresh invitation acquisition fails", async () => {
    const setup = await createSetup({ invitationFailure: true });

    expectResultError(await setup.subject.execute(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      setup.identity.publicIdentity,
      () => undefined,
    ), {
      code: "homeserver_signup_invitation_failed",
      cause: "homegate_unavailable",
      preservedPassportFileIdentity: setup.identity.publicIdentity,
    });
    expect(setup.events).toEqual(["wrapping-key", "drive-read", "restore-key", "homegate"]);
    expect(setup.pubky.disposedKeys).toEqual([setup.identity.keyHandle]);
  });
});

async function createSetup(input: { invitationFailure?: boolean } = {}) {
  const pubky = new RecordingPubkySdkAdapter();
  const identity = expectResultOk(await pubky.createIdentityKey());
  const events: string[] = [];
  const subject = new ResumeIncompleteGoogleBackedIdentity({
    requestWrappingKey: async () => {
      events.push("wrapping-key");
      return Result.ok("w".repeat(43));
    },
    readPassportFile: async () => {
      events.push("drive-read");
      return Result.ok({
        status: "found" as const,
        envelope: TEST_PASSPORT_ENVELOPE,
        reference: TEST_PASSPORT_REFERENCE,
      });
    },
    restoreIdentityKey: async () => {
      events.push("restore-key");
      return Result.ok(identity);
    },
    requestSignupInvitation: async () => {
      events.push("homegate");
      return input.invitationFailure
        ? Result.err({ code: "homegate_unavailable" as const })
        : Result.ok(TEST_SIGNUP_INVITATION);
    },
    activateIdentity: async (_identity, _invitation, reportProgress) => {
      events.push("activate");
      reportProgress("signing_up_to_homeserver");
      reportProgress("publishing_discovery");
      reportProgress("activating_created_identity");
      return Result.ok();
    },
    pubky,
  });
  return { subject, pubky, identity, events };
}
