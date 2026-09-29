import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "@test-utils/MemoryStorage";
import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";

import type {
  PubkyIdentityKey,
  PubkyIdentityKeyHandle,
} from "@/client/logic/pubky/pubkyIdentityKey";
import { LOGGER } from "@/libs/logger/logger";
import { MINIMUM_BACKUP_PASSWORD_LENGTH } from "@/client/logic/backup/BackupVerifier";
import { LocalAccountSetupController } from "./LocalAccountSetupController";
import { readUnfinishedAccount, releaseFinishedAccount } from "./unfinishedLocalAccount";
import type {
  SignupTokenChecker,
  SignupTokenLookup,
} from "@/client/logic/pubky/SignupTokenChecker";
import { LocalAccountDraftRepository } from "./LocalAccountDraftRepository";

const PUBLIC_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const OTHER_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const INVITE = { homeserverPubky: OTHER_KEY, signupToken: "invite-secret" };

describe("LocalAccountSetupController", () => {
  afterEach(() => vi.useRealTimers());

  it("can explicitly skip verification only after creating the backup", async () => {
    const { controller, pubky } = setup();
    expectResultOk(controller.prepareAccount(INVITE));
    expectResultError(controller.skipVerification(), { code: "backup_not_verified" });
    expectResultOk(controller.createBackup("correct horse"));
    expectResultOk(controller.returnToBackup());
    expectResultError(controller.skipVerification(), { code: "backup_not_verified" });
    expectResultOk(controller.createBackup("correct horse"));
    expectResultError(await controller.registerAccount(), { code: "backup_not_verified" });
    expectResultOk(controller.skipVerification());
    expectResultOk(await controller.registerAccount());
    expect(pubky.restoreRecoveryFile).not.toHaveBeenCalled();
    expect(pubky.signup).toHaveBeenCalledOnce();
  });

  it("encrypts new backups only with a password that meets the creation minimum", () => {
    const { controller, pubky } = setup();
    expectResultOk(controller.prepareAccount(INVITE));
    expectResultError(controller.createBackup("x".repeat(MINIMUM_BACKUP_PASSWORD_LENGTH - 1)), {
      code: "invalid_password",
    });
    expect(pubky.createRecoveryFile).not.toHaveBeenCalled();
    expectResultOk(controller.createBackup("x".repeat(MINIMUM_BACKUP_PASSWORD_LENGTH)));
  });

  it("persists the registration boundary before submitting an invite", async () => {
    const storage = new MemoryStorage();
    const { controller, pubky } = setup({ storage });
    expectResultOk(controller.prepareAccount(INVITE));
    expectResultOk(controller.createBackup("correct horse"));
    expectResultOk(controller.skipVerification());
    pubky.signup.mockImplementationOnce(async () => {
      const drafts = new LocalAccountDraftRepository(() => storage);
      expect(expectResultOk(drafts.read())?.registrationStarted).toBe(true);
      expectResultError(drafts.discardUnregistered(), { code: "draft_conflict" });
      return Result.err({ code: "signup_uncertain" }) as never;
    });
    pubky.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }) as never);
    expectResultError(
      await controller.registerAccount(),
      expect.objectContaining({ code: "signin_failed" }),
    );
    expect(controller.hasStartedRegistration).toBe(true);
    expectResultError(new LocalAccountDraftRepository(() => storage).discardUnregistered(), {
      code: "draft_conflict",
    });
    expectResultError(controller.discardUnregistered(), { code: "registration_started" });
    expect(expectResultOk(new LocalAccountDraftRepository(() => storage).read())).not.toBeNull();
  });

  it("reports a definitive invite rejection as terminal rather than retryable", async () => {
    const { controller, pubky } = setup();
    expectResultOk(controller.prepareAccount(INVITE));
    expectResultOk(controller.verifyBackup(new Uint8Array([9]), "correct horse"));
    pubky.signup.mockResolvedValueOnce(Result.err({ code: "signup_failed" }) as never);
    expectResultError(
      await controller.registerAccount(),
      expect.objectContaining({ code: "invite_rejected" }),
    );
    pubky.signup.mockResolvedValueOnce(Result.err({ code: "key_unavailable" }) as never);
    expectResultError(
      await controller.registerAccount(),
      expect.objectContaining({ code: "registration_failed" }),
    );
    expect(pubky.publishHomeserver).not.toHaveBeenCalled();
  });

  it("abandons a started registration explicitly, removing the draft and the key", async () => {
    const storage = new MemoryStorage();
    const { controller, pubky } = setup({ storage });
    expectResultOk(controller.prepareAccount(INVITE));
    expectResultOk(controller.verifyBackup(new Uint8Array([9]), "correct horse"));
    pubky.signup.mockResolvedValueOnce(Result.err({ code: "signup_failed" }) as never);
    expectResultError(
      await controller.registerAccount(),
      expect.objectContaining({ code: "invite_rejected" }),
    );
    expectResultError(controller.discardUnregistered(), { code: "registration_started" });
    expectResultOk(controller.abandonAccount());
    expect(pubky.disposeIdentityKey).toHaveBeenCalledWith("created");
    expect(expectResultOk(new LocalAccountDraftRepository(() => storage).read())).toBeNull();
    expect(controller.hasStartedRegistration).toBe(false);
    expectResultError(await controller.registerAccount(), { code: "create_failed" });
  });

  it("forgets an unregistered draft when the user leaves, but keeps a started one", () => {
    const storage = new MemoryStorage();
    const first = setup({ storage });
    expectResultOk(first.controller.prepareAccount(INVITE));
    expectResultOk(first.controller.createBackup("correct horse"));
    expectResultOk(first.controller.discardUnregistered());
    expect(first.pubky.disposeIdentityKey).toHaveBeenCalledWith("created");
    expect(expectResultOk(new LocalAccountDraftRepository(() => storage).read())).toBeNull();
    expectResultOk(first.controller.discardUnregistered());

    const resumed = setup({ storage });
    expectResultOk(resumed.controller.prepareAccount(INVITE));
    expect(resumed.pubky.createIdentityKey).toHaveBeenCalledOnce();
  });

  it("does not submit the invite if the registration boundary cannot be saved", async () => {
    const storage = new MemoryStorage();
    const { controller, pubky } = setup({ storage });
    expectResultOk(controller.prepareAccount(INVITE));
    expectResultOk(controller.createBackup("correct horse"));
    expectResultOk(controller.skipVerification());
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expectResultError(
      await controller.registerAccount(),
      expect.objectContaining({ code: "draft_storage_failed" }),
    );
    expect(pubky.signup).not.toHaveBeenCalled();
    expect(controller.hasStartedRegistration).toBe(false);
  });

  it("submits nothing and keeps the invite unsubmitted while its homeserver does not answer", async () => {
    const storage = new MemoryStorage();
    const { controller, invites, pubky } = setup({ storage });
    expectResultOk(controller.prepareAccount(INVITE));
    expectResultOk(controller.verifyBackup(new Uint8Array([9]), "correct horse"));
    invites.lookUp.mockResolvedValueOnce({ status: "unknown", reached: false });

    expectResultError(await controller.registerAccount(), { code: "homeserver_unreachable" });
    expect(invites.lookUp).toHaveBeenCalledWith(INVITE, expect.any(AbortSignal));
    expect(pubky.signup).not.toHaveBeenCalled();
    expect(pubky.publishHomeserver).not.toHaveBeenCalled();
    expect(controller.hasStartedRegistration).toBe(false);
    expect(
      expectResultOk(new LocalAccountDraftRepository(() => storage).read())?.registrationStarted,
    ).not.toBe(true);

    // The same key retries once the homeserver answers, even without confirming the invite.
    invites.lookUp.mockResolvedValueOnce({ status: "unknown", reached: true });
    expectResultOk(await controller.registerAccount());
    expect(pubky.signup).toHaveBeenCalledOnce();
  });

  it("keeps a started registration bound when a retry cannot reach the homeserver", async () => {
    const { controller, invites, pubky } = setup();
    expectResultOk(controller.prepareAccount(INVITE));
    expectResultOk(controller.verifyBackup(new Uint8Array([9]), "correct horse"));
    pubky.signup.mockResolvedValueOnce(Result.err({ code: "signup_uncertain" }) as never);
    pubky.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }) as never);
    expectResultError(
      await controller.registerAccount(),
      expect.objectContaining({ code: "signin_failed" }),
    );

    invites.lookUp.mockResolvedValueOnce({ status: "used", reached: false });
    expectResultError(await controller.registerAccount(), { code: "homeserver_unreachable" });
    expect(controller.hasStartedRegistration).toBe(true);
    expectResultError(controller.discardUnregistered(), { code: "registration_started" });
    expect(pubky.signup).toHaveBeenCalledOnce();
    expect(pubky.publishHomeserver).toHaveBeenCalledOnce();
  });

  it("marks nothing when disposed while the homeserver is looked up", async () => {
    const storage = new MemoryStorage();
    const { controller, invites, pubky } = setup({ storage });
    expectResultOk(controller.prepareAccount(INVITE));
    expectResultOk(controller.verifyBackup(new Uint8Array([9]), "correct horse"));
    const lookup = Promise.withResolvers<SignupTokenLookup>();
    invites.lookUp.mockReturnValueOnce(lookup.promise);

    const registration = controller.registerAccount();
    controller.dispose();
    expect(invites.lookUp.mock.calls[0]?.[1].aborted).toBe(true);
    lookup.resolve({ status: "unknown", reached: false });
    expectResultError(await registration, { code: "create_failed" });
    expect(pubky.signup).not.toHaveBeenCalled();
    expect(
      expectResultOk(new LocalAccountDraftRepository(() => storage).read())?.registrationStarted,
    ).not.toBe(true);
  });

  it("advances progress only as registration operations finish", async () => {
    const { controller, pubky } = setup();
    expectResultOk(controller.prepareAccount(INVITE));
    expectResultOk(controller.verifyBackup(new Uint8Array([9]), "correct horse"));
    const signup = Promise.withResolvers<void>();
    const publishing = Promise.withResolvers<void>();
    const activating = Promise.withResolvers<void>();
    pubky.signup.mockImplementationOnce(async () => {
      await signup.promise;
      return Result.ok({ publicIdentity: { publicKeyZ32: PUBLIC_KEY } });
    });
    pubky.publishHomeserver.mockImplementationOnce(async () => {
      await publishing.promise;
      return Result.ok();
    });
    pubky.signin.mockImplementationOnce(async () => {
      await activating.promise;
      return Result.ok({ publicIdentity: { publicKeyZ32: PUBLIC_KEY } });
    });
    const progress = vi.fn();
    const registration = controller.registerAccount(progress);
    expect(progress.mock.calls).toEqual([["signing_up"]]);
    signup.resolve();
    await vi.waitFor(() => expect(progress.mock.calls).toEqual([["signing_up"], ["publishing"]]));
    expect(pubky.signin).not.toHaveBeenCalled();
    publishing.resolve();
    await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith("activating"));
    activating.resolve();
    expectResultOk(await registration);
    expect(progress.mock.calls).toEqual([["signing_up"], ["publishing"], ["activating"]]);
  });

  it("does not show later progress when registration fails", async () => {
    const { controller, pubky } = setup();
    expectResultOk(controller.prepareAccount(INVITE));
    expectResultOk(controller.verifyBackup(new Uint8Array([9]), "correct horse"));
    pubky.signup.mockResolvedValueOnce(Result.err({ code: "signup_failed" }) as never);
    const progress = vi.fn();
    expectResultError(
      await controller.registerAccount(progress),
      expect.objectContaining({ code: "invite_rejected" }),
    );
    expect(progress.mock.calls).toEqual([["signing_up"]]);
    expect(pubky.publishHomeserver).not.toHaveBeenCalled();
  });

  it("restores the same key and backup step without making an unfinished account signable", async () => {
    const storage = new MemoryStorage();
    const first = setup({ storage });
    const prepared = expectResultOk(first.controller.prepareAccount(INVITE));
    expectResultOk(first.controller.createBackup("correct horse"));
    expect(first.repository.save).not.toHaveBeenCalled();
    first.controller.dispose();

    const resumed = setup({ storage });
    expect(expectResultOk(resumed.controller.prepareAccount(INVITE))).toEqual(prepared);
    expect(resumed.controller.preparedStep).toBe("confirm");
    expect(resumed.pubky.createIdentityKey).not.toHaveBeenCalled();
    // The resumed instance did not encrypt this backup, so its file must be checked.
    expectResultError(resumed.controller.skipVerification(), { code: "backup_not_verified" });
    expectResultError(
      await resumed.controller.registerAccount(),
      expect.objectContaining({ code: "backup_not_verified" }),
    );
    expect(resumed.pubky.signup).not.toHaveBeenCalled();
    expectResultOk(resumed.controller.verifyBackup(new Uint8Array([9]), "correct horse"));
    expect(expectResultOk(await resumed.controller.registerAccount()).profileSetupRequired).toBe(
      true,
    );
    expect(resumed.pubky.signup).toHaveBeenCalledWith(
      "resumed",
      INVITE.homeserverPubky,
      INVITE.signupToken,
    );
    expect(expectResultOk(new LocalAccountDraftRepository(() => storage).read())).toBeNull();
    expect(resumed.repository.save).toHaveBeenCalledOnce();
  });

  it("preserves the prepared key when stepping back and refuses to replace its invite", () => {
    const storage = new MemoryStorage();
    const first = setup({ storage });
    expectResultOk(first.controller.prepareAccount(INVITE));
    expectResultOk(first.controller.createBackup("correct horse"));
    expectResultOk(first.controller.returnToBackup());
    first.controller.dispose();
    const conflict = setup({ storage });
    expectResultError(
      conflict.controller.prepareAccount({ ...INVITE, signupToken: "other-invite" }),
      expect.objectContaining({ code: "create_failed" }),
    );
    expect(conflict.pubky.createIdentityKey).not.toHaveBeenCalled();
    const resumed = setup({ storage });
    expectResultOk(resumed.controller.prepareAccount(INVITE));
    expect(resumed.controller.preparedStep).toBe("password");
    expect(resumed.pubky.createIdentityKey).not.toHaveBeenCalled();
  });

  it("does not expose an unsaved key or consume an invite if storage fails", () => {
    const storage = new MemoryStorage();
    const { controller, pubky } = setup({ storage });
    const secret = { bytes: new Uint8Array(32).fill(1), format: "pubky-secret-key" as const };
    pubky.exportSecretKey.mockReturnValueOnce(Result.ok(secret));
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expectResultError(
      controller.prepareAccount(INVITE),
      expect.objectContaining({ code: "storage_failed" }),
    );
    expect(pubky.disposeIdentityKey).toHaveBeenCalledWith("created");
    expect(pubky.signup).not.toHaveBeenCalled();
    expect(secret.bytes.every((byte) => byte === 0)).toBe(true);
  });

  it("rejects a saved secret that derives a different public key", () => {
    const storage = new MemoryStorage();
    expectResultOk(setup({ storage }).controller.prepareAccount(INVITE));
    const resumed = setup({ storage });
    resumed.pubky.restoreIdentityKey.mockReturnValueOnce(
      Result.ok(identity(OTHER_KEY, "mismatch")),
    );
    expectResultError(
      resumed.controller.prepareAccount(INVITE),
      expect.objectContaining({ code: "create_failed" }),
    );
    expect(resumed.pubky.disposeIdentityKey).toHaveBeenCalledWith("mismatch");
    expect(resumed.pubky.signup).not.toHaveBeenCalled();
  });

  it("recovers uncertain registration after reload using the saved key and invite", async () => {
    const storage = new MemoryStorage();
    const first = setup({ storage });
    expectResultOk(first.controller.prepareAccount(INVITE));
    expectResultOk(first.controller.createBackup("correct horse"));
    expectResultOk(first.controller.verifyBackup(new Uint8Array([9]), "correct horse"));
    first.pubky.signup.mockResolvedValueOnce(Result.err({ code: "signup_uncertain" }) as never);
    first.pubky.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }) as never);
    expectResultError(
      await first.controller.registerAccount(),
      expect.objectContaining({ code: "signin_failed" }),
    );
    first.controller.dispose();
    const resumed = setup({ storage });
    expectResultOk(resumed.controller.prepareAccount(INVITE));
    expectResultOk(resumed.controller.verifyBackup(new Uint8Array([9]), "correct horse"));
    resumed.pubky.signup.mockResolvedValueOnce(Result.err({ code: "account_exists" }) as never);
    expectResultOk(await resumed.controller.registerAccount());
    expect(resumed.pubky.createIdentityKey).not.toHaveBeenCalled();
    expect(resumed.pubky.signup).toHaveBeenCalledWith(
      "resumed",
      INVITE.homeserverPubky,
      INVITE.signupToken,
    );
  });
  it("rejects malformed and wrongly encrypted backups without using the invite", async () => {
    const { controller, pubky } = setup();
    expect(Result.isOk(controller.prepareAccount(INVITE))).toBe(true);

    const malformed = new Uint8Array();
    const invalid = controller.verifyBackup(malformed, "correct horse");
    expect(Result.isError(invalid) && invalid.error.code).toBe("invalid_backup");
    expect(pubky.restoreRecoveryFile).not.toHaveBeenCalled();

    pubky.restoreRecoveryFile.mockReturnValueOnce(Result.err({ code: "restore_failed" }) as never);
    const wrongPassword = controller.verifyBackup(new Uint8Array([1, 2, 3]), "wrong password");
    expect(Result.isError(wrongPassword) && wrongPassword.error.code).toBe(
      "backup_decryption_failed",
    );
    expect(pubky.signup).not.toHaveBeenCalled();
  });

  it("requires a matching re-import before consuming the signup token", async () => {
    const { controller, pubky } = setup();

    expect(Result.isOk(controller.prepareAccount(INVITE))).toBe(true);
    expect(Result.isOk(controller.createBackup("correct horse"))).toBe(true);
    pubky.restoreRecoveryFile.mockReturnValueOnce(Result.ok(identity(OTHER_KEY)));

    const mismatch = controller.verifyBackup(new Uint8Array([1, 2, 3]), "correct horse");
    expect(Result.isError(mismatch) && mismatch.error.code).toBe("backup_mismatch");
    expect(pubky.signup).not.toHaveBeenCalled();

    const registration = await controller.registerAccount();
    expect(Result.isError(registration) && registration.error.code).toBe("backup_not_verified");
    expect(pubky.signup).not.toHaveBeenCalled();
  });

  it("retries uncertain registration with the same SDK key handle", async () => {
    const { controller, pubky } = setup();
    const prepared = controller.prepareAccount(INVITE);
    if (Result.isError(prepared)) throw new Error("expected prepared account");
    pubky.restoreRecoveryFile.mockReturnValueOnce(Result.ok(identity(PUBLIC_KEY, "confirmation")));
    expect(Result.isOk(controller.verifyBackup(new Uint8Array([9]), "correct horse"))).toBe(true);
    pubky.signin
      .mockResolvedValueOnce(Result.err({ code: "signin_failed" }) as never)
      .mockResolvedValueOnce(Result.ok({ publicIdentity: { publicKeyZ32: PUBLIC_KEY } }));
    pubky.signup
      .mockResolvedValueOnce(Result.err({ code: "signup_uncertain" }) as never)
      .mockResolvedValueOnce(Result.err({ code: "account_exists" }) as never);

    expect(Result.isError(await controller.registerAccount())).toBe(true);
    expect(Result.isOk(await controller.registerAccount())).toBe(true);

    expect(pubky.signup).toHaveBeenCalledTimes(2);
    const signupCalls = pubky.signup.mock.calls as unknown[][];
    expect(signupCalls[1]?.[0]).toBe(signupCalls[0]?.[0]);
  });

  it("remembers the homeserver a new account was signed up on and its checked backup", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 8, 29), toFake: ["Date"] });
    const verified = { verifiedAt: "2026-09-29T00:00:00.000Z" };
    const registration = setup();
    expectResultOk(registration.controller.prepareAccount(INVITE));
    expectResultOk(registration.controller.verifyBackup(new Uint8Array([9]), "correct horse"));
    expect(expectResultOk(await registration.controller.registerAccount())).toEqual({
      publicIdentity: { publicKeyZ32: PUBLIC_KEY },
      profileSetupRequired: true,
      homeserverPubky: INVITE.homeserverPubky,
      backup: verified,
    });

    const reregistration = setup({
      identities: [{ publicIdentity: { publicKeyZ32: PUBLIC_KEY } }],
    });
    expectResultOk(reregistration.controller.prepareAccount(INVITE));
    expectResultOk(reregistration.controller.verifyBackup(new Uint8Array([9]), "correct horse"));
    expect(expectResultOk(await reregistration.controller.registerAccount())).toEqual({
      publicIdentity: { publicKeyZ32: PUBLIC_KEY },
      homeserverPubky: INVITE.homeserverPubky,
      backup: verified,
    });
  });

  it("records a backup whose check was skipped as created, not checked", async () => {
    const { controller } = setup();
    expectResultOk(controller.prepareAccount(INVITE));
    expectResultOk(controller.createBackup("correct horse battery"));
    expectResultOk(controller.skipVerification());
    expect(expectResultOk(await controller.registerAccount()).backup).toEqual({
      createdAt: expect.any(String),
    });
  });

  it("refuses to turn a Ring-held identity into a local key when registration finishes", async () => {
    const { controller, repository } = setup({
      identities: [{ publicIdentity: { publicKeyZ32: PUBLIC_KEY }, keySource: "ring" }],
    });
    expectResultOk(controller.prepareAccount(INVITE));
    expectResultOk(controller.verifyBackup(new Uint8Array([9]), "correct horse"));
    expectResultError(await controller.registerAccount(), { code: "external_key" });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("publishes the invite's homeserver and tolerates a failed publication", async () => {
    const { controller, pubky, repository } = setup();
    expectResultOk(controller.prepareAccount(INVITE));
    expectResultOk(controller.verifyBackup(new Uint8Array([9]), "correct horse"));
    pubky.publishHomeserver.mockResolvedValueOnce(Result.err({ code: "publish_failed" }) as never);
    expect(expectResultOk(await controller.registerAccount()).profileSetupRequired).toBe(true);
    expect(pubky.publishHomeserver).toHaveBeenCalledWith("created", INVITE.homeserverPubky);
    expect(pubky.signin).toHaveBeenCalledWith("created", "after-publication");
    expect(repository.save).toHaveBeenCalledOnce();
  });

  it.each(["key_unavailable", "invalid_homeserver_pubky"])(
    "stops registration without saving when publication fails with %s",
    async (code) => {
      const { controller, pubky, repository } = setup();
      expectResultOk(controller.prepareAccount(INVITE));
      expectResultOk(controller.verifyBackup(new Uint8Array([9]), "correct horse"));
      pubky.publishHomeserver.mockResolvedValueOnce(Result.err({ code }) as never);
      expectResultError(await controller.registerAccount(), {
        code: "registration_failed",
        cause: { code },
      });
      expect(pubky.signin).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    },
  );

  it("still saves a registered account when the draft cannot be removed", async () => {
    const storage = new MemoryStorage();
    const { controller, repository } = setup({ storage });
    expectResultOk(controller.prepareAccount(INVITE));
    expectResultOk(controller.verifyBackup(new Uint8Array([9]), "correct horse"));
    vi.spyOn(storage, "removeItem").mockImplementation(() => {
      throw new Error("locked");
    });
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    expect(expectResultOk(await controller.registerAccount()).profileSetupRequired).toBe(true);
    expect(repository.save).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "identity.local_account.cleanup.failed",
      expect.objectContaining({ operation: "remove_draft", code: "storage_unavailable" }),
    );
    warning.mockRestore();
  });

  it("reads a registered draft as finished without writing, and drops it before preparing", () => {
    const storage = new MemoryStorage();
    const first = setup({ storage });
    expectResultOk(first.controller.prepareAccount(INVITE));
    first.controller.dispose();

    const drafts = new LocalAccountDraftRepository(() => storage);
    const catalog = (identities: Array<{ publicIdentity: { publicKeyZ32: string } }>) => ({
      list: () => Result.ok({ activePublicKeyZ32: null, identities }),
    });
    expect(expectResultOk(readUnfinishedAccount(drafts, catalog([])))?.publicIdentity).toEqual({
      publicKeyZ32: PUBLIC_KEY,
    });
    const removeItem = vi.spyOn(storage, "removeItem");
    const setItem = vi.spyOn(storage, "setItem");
    expect(
      expectResultOk(
        readUnfinishedAccount(drafts, catalog([{ publicIdentity: { publicKeyZ32: PUBLIC_KEY } }])),
      ),
    ).toBeNull();
    expect(removeItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(expectResultOk(drafts.read())).not.toBeNull();
    vi.restoreAllMocks();

    const registered = setup({
      storage,
      identities: [{ publicIdentity: { publicKeyZ32: PUBLIC_KEY } }],
    });
    registered.pubky.createIdentityKey.mockReturnValueOnce(Result.ok(identity(OTHER_KEY, "fresh")));
    expect(expectResultOk(registered.controller.prepareAccount(INVITE)).publicIdentity).toEqual({
      publicKeyZ32: OTHER_KEY,
    });
    expect(registered.pubky.restoreIdentityKey).not.toHaveBeenCalled();
    expect(expectResultOk(drafts.read())?.publicIdentity.publicKeyZ32).toBe(OTHER_KEY);
  });

  it("releases only a draft whose registration finished", () => {
    const storage = new MemoryStorage();
    expectResultOk(setup({ storage }).controller.prepareAccount(INVITE));
    const drafts = new LocalAccountDraftRepository(() => storage);
    const catalog = (identities: Array<{ publicIdentity: { publicKeyZ32: string } }>) => ({
      list: () => Result.ok({ activePublicKeyZ32: null, identities }),
    });

    releaseFinishedAccount(drafts, catalog([{ publicIdentity: { publicKeyZ32: OTHER_KEY } }]));
    expect(expectResultOk(drafts.read())?.publicIdentity.publicKeyZ32).toBe(PUBLIC_KEY);

    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const removeItem = vi.spyOn(storage, "removeItem").mockImplementationOnce(() => {
      throw new Error("locked");
    });
    const registered = catalog([{ publicIdentity: { publicKeyZ32: PUBLIC_KEY } }]);
    releaseFinishedAccount(drafts, registered);
    expect(expectResultOk(drafts.read())).not.toBeNull();
    expect(warning).toHaveBeenCalledWith(
      "identity.local_account.cleanup.failed",
      expect.objectContaining({ operation: "release_registered_draft" }),
    );

    releaseFinishedAccount(drafts, registered);
    expect(removeItem).toHaveBeenCalledTimes(2);
    expect(expectResultOk(drafts.read())).toBeNull();
    vi.restoreAllMocks();
  });

  it("resumes a registered draft it cannot remove instead of failing setup", () => {
    const storage = new MemoryStorage();
    expectResultOk(setup({ storage }).controller.prepareAccount(INVITE));
    const registered = setup({
      storage,
      identities: [{ publicIdentity: { publicKeyZ32: PUBLIC_KEY } }],
    });
    vi.spyOn(storage, "removeItem").mockImplementation(() => {
      throw new Error("locked");
    });
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    expectResultOk(registered.controller.prepareAccount(INVITE));
    expect(registered.pubky.restoreIdentityKey).toHaveBeenCalledOnce();
    expect(registered.pubky.createIdentityKey).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      "identity.local_account.cleanup.failed",
      expect.objectContaining({
        operation: "release_registered_draft",
        code: "storage_unavailable",
      }),
    );
    vi.restoreAllMocks();
  });

  it("keeps the verified key available when local storage fails", async () => {
    const { controller, pubky, repository } = setup();
    repository.save.mockReturnValueOnce(Result.err({ code: "storage_unavailable" }) as never);
    expect(Result.isOk(controller.prepareAccount(INVITE))).toBe(true);
    expect(Result.isOk(controller.verifyBackup(new Uint8Array([9]), "correct horse"))).toBe(true);

    const firstRegistration = await controller.registerAccount();
    expect(Result.isError(firstRegistration) && firstRegistration.error.code).toBe(
      "storage_failed",
    );
    expect(pubky.disposeIdentityKey).not.toHaveBeenCalledWith("created");

    const retry = await controller.registerAccount();
    expect(Result.isOk(retry)).toBe(true);
    const exportCalls = pubky.exportSecretKey.mock.calls as unknown[][];
    const exportedHandles = exportCalls.map(([handle]) => handle);
    expect(new Set(exportedHandles)).toEqual(new Set(["created"]));
  });
});

function setup({
  identities = [],
  storage = new MemoryStorage(),
}: { identities?: Array<Record<string, unknown>>; storage?: Storage } = {}) {
  const created = identity(PUBLIC_KEY, "created");
  const pubky = {
    createIdentityKey: vi.fn(() => Result.ok(created)),
    createRecoveryFile: vi.fn(() => Result.ok(new Uint8Array([4, 5, 6]))),
    dispose: vi.fn(),
    disposeIdentityKey: vi.fn(),
    exportSecretKey: vi.fn(() =>
      Result.ok({ bytes: new Uint8Array(32).fill(1), format: "pubky-secret-key" as const }),
    ),
    publishHomeserver: vi.fn(async () => Result.ok()),
    restoreRecoveryFile: vi.fn(() => Result.ok(identity(PUBLIC_KEY, "restored"))),
    restoreIdentityKey: vi.fn(() => Result.ok(identity(PUBLIC_KEY, "resumed"))),
    signin: vi.fn(async () => Result.ok({ publicIdentity: { publicKeyZ32: PUBLIC_KEY } })),
    signup: vi.fn(async () => Result.ok({ publicIdentity: { publicKeyZ32: PUBLIC_KEY } })),
  };
  const repository = {
    list: vi.fn(() => Result.ok({ activePublicKeyZ32: null, identities })),
    save: vi.fn((metadata: unknown) => Result.ok(metadata)),
  };
  const invites = {
    lookUp: vi.fn<SignupTokenChecker["lookUp"]>(async () => ({ status: "valid", reached: true })),
  };
  return {
    controller: new LocalAccountSetupController(
      pubky as never,
      repository as never,
      new LocalAccountDraftRepository(() => storage),
      invites,
    ),
    invites,
    pubky,
    repository,
  };
}

function identity(publicKeyZ32: string, handle = "handle"): PubkyIdentityKey {
  return {
    keyHandle: handle as unknown as PubkyIdentityKeyHandle,
    publicIdentity: { publicKeyZ32 },
  };
}
