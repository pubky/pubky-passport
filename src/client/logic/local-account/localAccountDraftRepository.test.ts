import { describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "@test-utils/MemoryStorage";
import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";
import { LocalAccountDraftRepository, type LocalAccountDraft } from "./LocalAccountDraftRepository";

const KEY = "pubky-passport/local-account-draft/v1";
const DRAFT: LocalAccountDraft = {
  publicIdentity: { publicKeyZ32: "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy" },
  invite: {
    homeserverPubky: "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo",
    signupToken: "invite-secret",
  },
  step: "password",
};
const secret = () => ({ bytes: new Uint8Array(32).fill(1), format: "pubky-secret-key" as const });

describe("LocalAccountDraftRepository", () => {
  it("persists an isolated draft without exposing the secret in navigation metadata", () => {
    const storage = new MemoryStorage();
    const drafts = new LocalAccountDraftRepository(() => storage);
    expectResultOk(drafts.create(DRAFT, secret()));
    expect(expectResultOk(new LocalAccountDraftRepository(() => storage).read())).toEqual(DRAFT);
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe(KEY);
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual({
      v: 1,
      publicKeyZ32: DRAFT.publicIdentity.publicKeyZ32,
      secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      ...DRAFT.invite,
      step: "password",
    });
    expect(expectResultOk(drafts.restore())?.secretKey.bytes).toEqual(secret().bytes);
  });

  it("allows changing signer before registration, but preserves attempted registrations across reload", () => {
    const storage = new MemoryStorage();
    const drafts = new LocalAccountDraftRepository(() => storage);
    expectResultOk(drafts.create(DRAFT, secret()));
    expectResultOk(drafts.setStep(DRAFT.publicIdentity.publicKeyZ32, "confirm"));
    expectResultOk(drafts.discardUnregistered());
    expect(expectResultOk(drafts.read())).toBeNull();
    expectResultOk(drafts.create(DRAFT, secret()));
    expectResultOk(drafts.markRegistrationStarted(DRAFT.publicIdentity.publicKeyZ32));
    const resumed = new LocalAccountDraftRepository(() => storage);
    expect(expectResultOk(resumed.read())?.registrationStarted).toBe(true);
    expectResultError(resumed.discardUnregistered(), { code: "draft_conflict" });
    expect(expectResultOk(resumed.restore())?.secretKey.bytes).toEqual(secret().bytes);
  });

  it("keeps the existing draft if another setup tries to overwrite or remove it", () => {
    const storage = new MemoryStorage();
    const drafts = new LocalAccountDraftRepository(() => storage);
    expectResultOk(drafts.create(DRAFT, secret()));
    const saved = storage.getItem(KEY);
    expectResultError(drafts.create(DRAFT, secret()), { code: "draft_conflict" });
    expectResultError(drafts.remove(DRAFT.invite.homeserverPubky), { code: "draft_conflict" });
    expectResultError(drafts.setStep(DRAFT.invite.homeserverPubky, "confirm"), {
      code: "draft_conflict",
    });
    expect(storage.getItem(KEY)).toBe(saved);
  });

  it("retains the last saved step when a storage write fails", () => {
    const storage = new MemoryStorage();
    const drafts = new LocalAccountDraftRepository(() => storage);
    expectResultOk(drafts.create(DRAFT, secret()));
    const cause = new Error("quota");
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw cause;
    });
    expectResultError(drafts.setStep(DRAFT.publicIdentity.publicKeyZ32, "confirm"), {
      code: "storage_unavailable",
      cause,
    });
    expect(expectResultOk(drafts.read())).toEqual(DRAFT);
  });

  it("reports unavailable browser storage", () => {
    const cause = new Error("storage blocked");
    const drafts = new LocalAccountDraftRepository(() => {
      throw cause;
    });
    expectResultError(drafts.read(), { code: "storage_unavailable", cause });
    expectResultError(drafts.create(DRAFT, secret()), { code: "storage_unavailable", cause });
  });

  it.each(["{secret-key", '{"v":2}', '{"v":1,"secretKey":"invalid"}'])(
    "reads a draft without a usable key as empty and replaces it: %s",
    (raw) => {
      const storage = new MemoryStorage();
      storage.setItem(KEY, raw);
      const drafts = new LocalAccountDraftRepository(() => storage);
      expect(expectResultOk(drafts.read())).toBeNull();
      expect(expectResultOk(drafts.restore())).toBeNull();
      expectResultOk(drafts.discardUnregistered());
      expectResultOk(drafts.create(DRAFT, secret()));
      expect(expectResultOk(drafts.read())).toEqual(DRAFT);
    },
  );

  it("keeps an unreadable draft that still holds a key until its removal is confirmed", () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({
      v: 2,
      publicKeyZ32: DRAFT.publicIdentity.publicKeyZ32,
      secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
    });
    storage.setItem(KEY, raw);
    const drafts = new LocalAccountDraftRepository(() => storage);
    expectResultError(drafts.read(), { code: "invalid_draft" });
    expectResultError(drafts.restore(), { code: "invalid_draft" });
    expectResultError(drafts.create(DRAFT, secret()), { code: "invalid_draft" });
    expectResultError(drafts.discardUnregistered(), { code: "invalid_draft" });
    expect(storage.getItem(KEY)).toBe(raw);

    expectResultOk(drafts.removeUnreadable());
    expect(storage.getItem(KEY)).toBeNull();
    expectResultOk(drafts.removeUnreadable());
    expectResultOk(drafts.create(DRAFT, secret()));
  });

  it("removes only unreadable drafts through the confirmed escape hatch", () => {
    const storage = new MemoryStorage();
    const drafts = new LocalAccountDraftRepository(() => storage);
    expectResultOk(drafts.create(DRAFT, secret()));
    expectResultError(drafts.removeUnreadable(), { code: "draft_conflict" });
    expect(expectResultOk(drafts.read())).toEqual(DRAFT);

    const cause = new Error("storage blocked");
    const blocked = new LocalAccountDraftRepository(() => {
      throw cause;
    });
    expectResultError(blocked.removeUnreadable(), { code: "storage_unavailable", cause });
  });
});
