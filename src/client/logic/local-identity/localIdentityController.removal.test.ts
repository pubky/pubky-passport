/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectResultOk } from "@test-utils/resultAssertions";
import { LocalAccountDraftRepository } from "@/client/logic/local-account/LocalAccountDraftRepository";
import { readUnfinishedAccount } from "@/client/logic/local-account/unfinishedLocalAccount";
import {
  PUBKY_SECRET_KEY_FORMAT,
  type PubkySecretKeyMaterial,
} from "@/client/logic/pubky/pubkyIdentityKey";
import { encodeBase64Url } from "@/libs/encoding/base64Url";
import { LocalIdentityController } from "./LocalIdentityController";
import { LocalStorageIdentityRepository } from "./LocalStorageIdentityRepository";

const PUBLIC_KEY = "yqooxx9u3aemh8mo5wcqq16yufu6jitouq1o4za751dger1igghy";
const OTHER_KEY = "8um71us3fyw6h8wbcxb5ar3rwusy1a6u49956ikzojg3gcwd1dty";
const HOMESERVER = "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";
const SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const OTHER_SECRET = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);

function secret(bytes: Uint8Array): PubkySecretKeyMaterial {
  return { bytes: Uint8Array.from(bytes), format: PUBKY_SECRET_KEY_FORMAT };
}

function saveDraft(publicKeyZ32: string, bytes: Uint8Array) {
  expectResultOk(
    new LocalAccountDraftRepository().create(
      {
        publicIdentity: { publicKeyZ32 },
        invite: { homeserverPubky: HOMESERVER, signupToken: "INVITE-TOKEN" },
        step: "confirm",
        registrationStarted: true,
      },
      secret(bytes),
    ),
  );
}

function storedValues(): string[] {
  return Object.keys(localStorage).map((key) => localStorage.getItem(key) ?? "");
}

describe("LocalIdentityController.removeIdentity with an account-setup draft", () => {
  const repository = new LocalStorageIdentityRepository();

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("removes a same-key draft, so no stored value keeps the secret or offers it back", () => {
    // Setup finished, but the tab closed before the draft was released.
    saveDraft(PUBLIC_KEY, SECRET);
    expectResultOk(
      repository.save({ publicIdentity: { publicKeyZ32: PUBLIC_KEY } }, secret(SECRET)),
    );
    expect(storedValues().filter((value) => value.includes(encodeBase64Url(SECRET)))).toHaveLength(
      2,
    );

    expectResultOk(new LocalIdentityController().removeIdentity(PUBLIC_KEY));

    expect(storedValues().some((value) => value.includes(encodeBase64Url(SECRET)))).toBe(false);
    expect(new LocalAccountDraftRepository().restore()).toEqual(Result.ok(null));
    expect(readUnfinishedAccount()).toEqual(Result.ok(null));
  });

  it("never removes a draft of another key", () => {
    saveDraft(OTHER_KEY, OTHER_SECRET);
    expectResultOk(
      repository.save({ publicIdentity: { publicKeyZ32: PUBLIC_KEY } }, secret(SECRET)),
    );

    expectResultOk(new LocalIdentityController().removeIdentity(PUBLIC_KEY));

    const draft = expectResultOk(readUnfinishedAccount());
    expect(draft?.publicIdentity.publicKeyZ32).toBe(OTHER_KEY);
    expect(storedValues().some((value) => value.includes(encodeBase64Url(OTHER_SECRET)))).toBe(
      true,
    );
  });

  it("leaves a draft alone when its key is not a saved identity", () => {
    saveDraft(PUBLIC_KEY, SECRET);

    const removed = new LocalIdentityController().removeIdentity(PUBLIC_KEY);

    expect(Result.isError(removed) && removed.error.code).toBe("invalid_identity");
    expect(expectResultOk(readUnfinishedAccount())?.publicIdentity.publicKeyZ32).toBe(PUBLIC_KEY);
  });

  it("keeps the identity when the draft cannot be removed", () => {
    expectResultOk(
      repository.save({ publicIdentity: { publicKeyZ32: PUBLIC_KEY } }, secret(SECRET)),
    );
    const drafts = {
      remove: vi.fn(() => Result.err({ code: "storage_unavailable" as const })),
    };

    const removed = new LocalIdentityController(repository, drafts).removeIdentity(PUBLIC_KEY);

    expect(Result.isError(removed) && removed.error.code).toBe("storage_unavailable");
    expect(drafts.remove).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(expectResultOk(repository.list()).identities).toHaveLength(1);
  });
});
