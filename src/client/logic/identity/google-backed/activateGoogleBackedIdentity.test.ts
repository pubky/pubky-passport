import { describe, expect, it, vi } from "vitest";

import { RecordingPubkySdkAdapter } from "../../../../../test-utils/fakes/recordingPubkySdkAdapter";
import {
  TEST_SIGNUP_INVITATION,
  RecordingSaveLocalIdentity,
} from "../../../../../test-utils/fakes/googleBackedIdentityTestDoubles";
import { expectResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import { ActivateGoogleBackedIdentity } from "./activateGoogleBackedIdentity";

describe("ActivateGoogleBackedIdentity", () => {
  it("signs up, publishes discovery, and saves the same identity in order", async () => {
    const events: string[] = [];
    const setup = await createSetup(events);

    expectResultOk(await setup.subject.execute(
      setup.identity,
      TEST_SIGNUP_INVITATION,
      (progress) => events.push(progress),
    ));

    expect(events).toEqual([
      "signing_up_to_homeserver",
      "signup",
      "publishing_discovery",
      "discovery",
      "activating_created_identity",
      "save",
    ]);
    expect(setup.pubky.signupCalls).toEqual([{
      homeserverPubky: TEST_SIGNUP_INVITATION.homeserverPubky,
      hasSignupCode: true,
    }]);
    expect(setup.pubky.discoveryCalls).toEqual([{ hasHomeserverPubky: true }]);
    expect(setup.local.saveCalls).toBe(1);
  });

  it("rejects a signup session for a different Pubky before discovery or save", async () => {
    const setup = await createSetup();
    setup.pubky.session.publicIdentity = {
      publicKeyZ32: "different-identity",
      publicKeyDisplay: "pubkydifferent-identity",
    };

    expectResultError(await setup.subject.execute(
      setup.identity,
      TEST_SIGNUP_INVITATION,
      () => undefined,
    ), { code: "identity_mismatch" });
    expect(setup.pubky.discoveryCalls).toEqual([]);
    expect(setup.local.saveCalls).toBe(0);
  });
});

async function createSetup(events: string[] = []) {
  const pubky = new RecordingPubkySdkAdapter();
  const identity = expectResultOk(await pubky.createIdentityKey());
  pubky.session.publicIdentity = identity.publicIdentity;
  const local = new RecordingSaveLocalIdentity(() => events.push("save"));
  const signup = vi.spyOn(pubky, "signup");
  signup.mockImplementationOnce(async (input) => {
    events.push("signup");
    signup.mockRestore();
    return pubky.signup(input);
  });
  const publish = vi.spyOn(pubky, "publishHomeserverIfStale");
  publish.mockImplementationOnce(async (input) => {
    events.push("discovery");
    publish.mockRestore();
    return pubky.publishHomeserverIfStale(input);
  });
  return {
    subject: new ActivateGoogleBackedIdentity({
      pubky,
      saveIdentityLocally: local.saveIdentity,
    }),
    pubky,
    local,
    identity,
  };
}
