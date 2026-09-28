import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "@/libs/logger/logger";
import type { SignupTokenStatus } from "@/client/logic/pubky/SignupTokenChecker";
import { InviteDestinationController, selectedInvite } from "./InviteDestinationController";
import type { LocalAccountDraft } from "./LocalAccountDraftRepository";

const HOMESERVER = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const INVITE = { homeserverPubky: HOMESERVER, signupToken: "AB12-CD34-EF56" };
const OTHER = { homeserverPubky: HOMESERVER, signupToken: "ZZ99-YY88-XX77" };
const DRAFT: LocalAccountDraft = {
  publicIdentity: { publicKeyZ32: "draft-key" },
  invite: INVITE,
  step: "password",
};

function setup(
  options: {
    saved?: LocalAccountDraft | null;
    stored?: LocalAccountDraft | null;
    status?: SignupTokenStatus;
  } = {},
) {
  let stored: LocalAccountDraft | null = options.stored ?? options.saved ?? null;
  const drafts = {
    read: vi.fn(() => Result.ok(stored)),
    discardUnregistered: vi.fn(() => {
      if (stored?.registrationStarted) return Result.err({ code: "draft_conflict" as const });
      stored = null;
      return Result.ok();
    }),
  };
  const checkSignupToken = vi.fn<
    (invite: typeof INVITE, signal: AbortSignal) => Promise<SignupTokenStatus>
  >(async () => options.status ?? "valid");
  const controller = new InviteDestinationController(
    Result.ok(options.saved ?? null),
    checkSignupToken,
    drafts,
  );
  const listener = vi.fn();
  controller.subscribe(listener);
  return { controller, drafts, checkSignupToken, listener, stored: () => stored };
}

describe("InviteDestinationController", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resumes a saved setup's invite and a started registration", () => {
    const { controller } = setup({ saved: { ...DRAFT, registrationStarted: true } });
    expect(controller.getState()).toMatchObject({
      setupUnavailable: false,
      resumedInvite: INVITE,
      registrationStarted: true,
      destination: "choose",
    });
    expect(selectedInvite(controller.getState(), OTHER)).toBe(INVITE);
  });

  it.each([
    ["invalid_draft", true],
    ["storage_unavailable", false],
  ] as const)(
    "reports an unreadable saved setup without offering anything else (%s)",
    (code, setupRemovable) => {
      const controller = new InviteDestinationController(Result.err({ code }), vi.fn());
      expect(controller.getState()).toMatchObject({
        setupUnavailable: true,
        setupRemovable,
        resumedInvite: null,
      });
    },
  );

  it("prefers a submitted manual invite over Homegate's", () => {
    const { controller } = setup();
    expect(selectedInvite(controller.getState(), OTHER)).toBe(OTHER);
    controller.openInviteEntry();
    controller.submitInvite(INVITE);
    expect(controller.getState()).toMatchObject({ manualEntry: "submitted", manualInvite: INVITE });
    expect(selectedInvite(controller.getState(), OTHER)).toEqual(INVITE);
    controller.openInviteEntry();
    expect(selectedInvite(controller.getState(), OTHER)).toBe(OTHER);
  });

  it("releases a saved key bound to a different invite before accepting a new one", () => {
    const { controller, stored } = setup({ saved: DRAFT });
    controller.openInviteEntry();
    controller.submitInvite(OTHER);

    expect(stored()).toBeNull();
    expect(controller.getState()).toMatchObject({
      resumedInvite: null,
      registrationStarted: false,
      manualInvite: OTHER,
      error: null,
    });
  });

  it("keeps a submitted setup when a different invite cannot replace it", () => {
    const { controller, stored } = setup({ saved: { ...DRAFT, registrationStarted: true } });
    controller.submitInvite(OTHER);

    expect(stored()).not.toBeNull();
    expect(controller.getState()).toMatchObject({
      error: "invite_change_failed",
      resumedInvite: INVITE,
      manualEntry: "closed",
    });
  });

  it("reports a saved setup that cannot be read while an invite is changed", () => {
    const { controller, drafts } = setup();
    drafts.read.mockReturnValueOnce(Result.err({ code: "storage_unavailable" }) as never);
    controller.submitInvite(INVITE);
    expect(controller.getState().error).toBe("invite_change_failed");
  });

  it("goes straight to Passport with an invite Ring was never shown", async () => {
    const { controller, checkSignupToken } = setup();
    await controller.choosePassport(INVITE);
    expect(controller.getState().destination).toBe("passport");
    expect(checkSignupToken).not.toHaveBeenCalled();
  });

  it.each([
    ["used", "invite_used"],
    ["not_found", "invite_not_found"],
  ] as const)("blocks Passport when an invite shown to Ring is %s", async (status, error) => {
    const { controller, checkSignupToken } = setup({ status });
    void controller.chooseRing(INVITE);
    expect(controller.getState()).toMatchObject({ destination: "ring", sharedWithRing: true });
    controller.returnToChoice();

    await controller.choosePassport(INVITE);

    expect(checkSignupToken).toHaveBeenCalledWith(INVITE, expect.any(AbortSignal));
    expect(controller.getState()).toMatchObject({
      destination: "choose",
      checkingInvite: false,
      error,
    });
  });

  it.each(["valid", "unknown"] as const)(
    "lets a rechecked invite reach Passport when the homeserver answers %s",
    async (status) => {
      const { controller, checkSignupToken } = setup({ status });
      expect(await controller.choosePassport(INVITE, true)).toBe(status);
      expect(checkSignupToken).toHaveBeenCalledOnce();
      expect(controller.getState()).toMatchObject({ destination: "passport", error: null });
    },
  );

  it("reports a used invite so its source can stop keeping it", async () => {
    const { controller } = setup({ status: "used" });
    expect(await controller.choosePassport(INVITE, true)).toBe("used");
    expect(controller.getState()).toMatchObject({ usedInvite: INVITE, error: "invite_used" });
    expect(await controller.choosePassport(OTHER)).toBeNull();
  });

  it("opens Ring without a lookup unless the invite is restored", async () => {
    const { controller, checkSignupToken, stored } = setup({ saved: DRAFT });
    expect(await controller.chooseRing(INVITE)).toBeNull();
    expect(checkSignupToken).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
    expect(controller.getState()).toMatchObject({ destination: "ring", usedInvite: null });
  });

  it("looks up a restored invite before Ring shows it, leaving only the profile step if used", async () => {
    const { controller, checkSignupToken, stored } = setup({ saved: DRAFT, status: "used" });
    const pending = controller.chooseRing(INVITE, true);
    expect(controller.getState().checkingInvite).toBe(true);

    expect(await pending).toBe("used");
    expect(stored()).toBeNull();
    expect(controller.getState()).toMatchObject({
      destination: "ring",
      usedInvite: INVITE,
      checkingInvite: false,
      error: null,
    });

    controller.returnToChoice();
    expect(await controller.chooseRing(INVITE, true)).toBeNull();
    expect(checkSignupToken).toHaveBeenCalledOnce();
  });

  it("keeps a restored invite the homeserver does not know away from Ring", async () => {
    const { controller, stored } = setup({ saved: DRAFT, status: "not_found" });
    expect(await controller.chooseRing(INVITE, true)).toBe("not_found");
    expect(stored()).not.toBeNull();
    expect(controller.getState()).toMatchObject({
      destination: "choose",
      checkingInvite: false,
      error: "invite_not_found",
    });
  });

  it("never rechecks an invite already submitted with the Passport key", async () => {
    const { controller, checkSignupToken } = setup({
      saved: { ...DRAFT, registrationStarted: true },
      status: "used",
    });
    await controller.choosePassport(INVITE, true);
    expect(checkSignupToken).not.toHaveBeenCalled();
    expect(controller.getState().destination).toBe("passport");
  });

  it("ignores a check that finishes after the person went back to the invite form", async () => {
    const { controller, checkSignupToken } = setup();
    let answer!: (status: SignupTokenStatus) => void;
    checkSignupToken.mockImplementationOnce(
      () => new Promise<SignupTokenStatus>((resolve) => (answer = resolve)),
    );
    void controller.chooseRing(INVITE);
    controller.returnToChoice();
    const pending = controller.choosePassport(INVITE);
    expect(controller.getState().checkingInvite).toBe(true);
    await controller.choosePassport(INVITE);
    expect(checkSignupToken).toHaveBeenCalledOnce();

    controller.openInviteEntry();
    expect(checkSignupToken.mock.calls[0]?.[1].aborted).toBe(true);
    answer("valid");
    await pending;

    expect(controller.getState()).toMatchObject({
      manualEntry: "open",
      destination: "choose",
      checkingInvite: false,
      error: null,
    });
  });

  it("aborts a running check on dispose and exit", async () => {
    const { controller, checkSignupToken } = setup();
    checkSignupToken.mockImplementation(() => new Promise<SignupTokenStatus>(() => undefined));
    void controller.choosePassport(INVITE, true);
    controller.dispose();
    expect(checkSignupToken.mock.calls[0]?.[1].aborted).toBe(true);

    void controller.choosePassport(INVITE, true);
    controller.exit();
    expect(checkSignupToken.mock.calls[1]?.[1].aborted).toBe(true);
  });

  it("keeps a submitted key when Ring is chosen or the flow is left", () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    const { controller, stored } = setup({ saved: { ...DRAFT, registrationStarted: true } });

    void controller.chooseRing(INVITE);
    expect(controller.getState()).toMatchObject({
      destination: "choose",
      error: "invite_release_failed",
    });
    controller.exit();

    expect(stored()).not.toBeNull();
    expect(info).toHaveBeenCalledWith("signup.exit.draft_kept", { code: "draft_conflict" });
  });

  it("rereads a started registration when the Passport key flow is left", () => {
    const { controller, drafts } = setup();
    void controller.choosePassport(INVITE);
    drafts.read.mockReturnValueOnce(Result.ok({ ...DRAFT, registrationStarted: true }));

    controller.leavePassport();

    expect(controller.getState()).toMatchObject({
      destination: "choose",
      registrationStarted: true,
    });
  });

  it("forgets every copy of a rejected invite", () => {
    const { controller } = setup({ saved: DRAFT });
    controller.submitInvite(INVITE);
    void controller.chooseRing(INVITE);

    void controller.abandonPassport("invite_rejected", INVITE);

    expect(controller.getState()).toMatchObject({
      resumedInvite: null,
      manualInvite: null,
      manualEntry: "closed",
      sharedWithRing: false,
    });
    expect(selectedInvite(controller.getState(), null)).toBeNull();
  });

  it("keeps the invite when the person only abandons the Passport key", () => {
    const { controller } = setup({ saved: DRAFT });
    void controller.abandonPassport("user", INVITE);
    expect(controller.getState()).toMatchObject({
      resumedInvite: INVITE,
      registrationStarted: false,
    });
  });

  it.each(["used", "not_found"] as const)(
    "forgets a submitted invite the homeserver reports %s once its key is dropped",
    async (status) => {
      const { controller, checkSignupToken } = setup({ saved: DRAFT, status });
      controller.submitInvite(INVITE);

      expect(await controller.abandonPassport("invite_submitted", INVITE)).toBe(status);

      expect(checkSignupToken).toHaveBeenCalledWith(INVITE, expect.any(AbortSignal));
      expect(controller.getState()).toMatchObject({ checkingInvite: false, inviteToRecheck: null });
      expect(selectedInvite(controller.getState(), null)).toBeNull();
    },
  );

  it("keeps a submitted invite a lookup found valid without checking it again", async () => {
    const { controller, checkSignupToken } = setup({ saved: DRAFT });
    expect(await controller.abandonPassport("invite_submitted", INVITE)).toBe("valid");
    expect(controller.getState()).toMatchObject({ resumedInvite: INVITE, inviteToRecheck: null });

    await controller.choosePassport(INVITE);
    expect(controller.getState().destination).toBe("passport");
    expect(checkSignupToken).toHaveBeenCalledOnce();
  });

  it.each(["choosePassport", "chooseRing"] as const)(
    "looks up a submitted invite again before %s uses it when the first lookup failed",
    async (choose) => {
      const { controller, checkSignupToken } = setup({ saved: DRAFT, status: "unknown" });
      await controller.abandonPassport("invite_submitted", INVITE);
      expect(controller.getState()).toMatchObject({
        resumedInvite: INVITE,
        inviteToRecheck: INVITE,
      });

      checkSignupToken.mockResolvedValueOnce("used");
      expect(await controller[choose](INVITE)).toBe("used");
      expect(controller.getState()).toMatchObject({
        destination: "choose",
        error: "invite_redeemed",
        usedInvite: null,
      });

      checkSignupToken.mockResolvedValueOnce("valid");
      expect(await controller[choose](INVITE)).toBe("valid");
      expect(controller.getState()).toMatchObject({ error: null, inviteToRecheck: null });
      expect(controller.getState().destination).not.toBe("choose");
      expect(checkSignupToken).toHaveBeenCalledTimes(3);
    },
  );

  it("still checks a submitted invite whose lookup was cancelled", async () => {
    const { controller, checkSignupToken } = setup({ saved: DRAFT });
    let answer!: (status: SignupTokenStatus) => void;
    checkSignupToken.mockImplementationOnce(
      () => new Promise<SignupTokenStatus>((resolve) => (answer = resolve)),
    );
    const abandoned = controller.abandonPassport("invite_submitted", INVITE);
    controller.openInviteEntry();
    answer("valid");

    expect(await abandoned).toBeNull();
    expect(controller.getState()).toMatchObject({ checkingInvite: false, inviteToRecheck: INVITE });
    controller.closeInviteEntry();
    await controller.choosePassport(INVITE);
    expect(checkSignupToken).toHaveBeenCalledTimes(2);
  });

  it("discards an invite with its unsubmitted key, unless registration started", () => {
    const released = setup({ saved: DRAFT });
    expect(released.controller.discardInvite()).toBe(true);
    expect(released.stored()).toBeNull();
    expect(selectedInvite(released.controller.getState(), null)).toBeNull();

    const submitted = setup({ saved: { ...DRAFT, registrationStarted: true } });
    expect(submitted.controller.discardInvite()).toBe(false);
    expect(submitted.controller.getState()).toMatchObject({
      resumedInvite: INVITE,
      error: "invite_release_failed",
    });
  });

  it("closes the invite form without keeping a destination error", () => {
    const { controller, listener } = setup({ status: "used" });
    controller.openInviteEntry();
    controller.closeInviteEntry();
    expect(controller.getState()).toMatchObject({ manualEntry: "closed", error: null });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
