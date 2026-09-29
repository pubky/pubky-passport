import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "@test-utils/MemoryStorage";
import { LOGGER } from "@/libs/logger/logger";
import { HomegateSignupController } from "./HomegateSignupController";
import { HomegateSignupRepository } from "./HomegateSignupRepository";
import type { HomegateVerificationFailure, LightningInvoice } from "./HomegateVerificationClient";

const HOMESERVER = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const INVITE = { homeserverPubky: HOMESERVER, signupToken: "AB12-CD34-EF56" };
const START = 1_800_000_000_000;
const INVOICE: LightningInvoice = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  amountSat: 100,
  bolt11Invoice: "lnbc100n1example",
  expiresAt: START + 60_000,
};
const EXPIRING: LightningInvoice = { ...INVOICE, expiresAt: START + 1_000 };
const REPLACEMENT: LightningInvoice = { ...INVOICE, id: "7c9e6679-7425-40de-944b-e07fc1f90ae7" };

type Answer<T> = Result<T, HomegateVerificationFailure>;
const failure = (code: HomegateVerificationFailure["code"]) => Result.err({ code });
const unpaid = (): Answer<typeof INVITE | null> => Result.ok(null);
const paid = (): Answer<typeof INVITE | null> => Result.ok(INVITE);

function fakeVerification() {
  return {
    sendSmsCode: vi.fn<(phone: string, signal: AbortSignal) => Promise<Answer<void>>>(async () =>
      Result.ok(),
    ),
    verifySmsCode: vi.fn<
      (phone: string, code: string, signal: AbortSignal) => Promise<Answer<typeof INVITE>>
    >(async () => Result.ok(INVITE)),
    createLightningInvoice: vi.fn<(signal: AbortSignal) => Promise<Answer<LightningInvoice>>>(
      async () => Result.ok(INVOICE),
    ),
    checkLightningPayment: vi.fn<
      (id: string, signal: AbortSignal) => Promise<Answer<typeof INVITE | null>>
    >(async () => unpaid()),
  };
}

function setup(storage = new MemoryStorage()) {
  const verification = fakeVerification();
  const repository = new HomegateSignupRepository(() => storage);
  const controller = new HomegateSignupController(verification, repository);
  const listener = vi.fn();
  controller.subscribe(listener);
  return { controller, verification, repository, storage, listener };
}

describe("HomegateSignupController", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("advances through SMS verification and keeps the issued invite", async () => {
    const { controller, verification, repository, listener } = setup();
    verification.verifySmsCode.mockResolvedValueOnce(failure("invalid_code"));

    controller.chooseSms();
    expect(controller.getState().view).toEqual({ step: "phone", phoneNumber: "" });
    await controller.sendSmsCode("+41791234567");
    expect(controller.getState()).toMatchObject({
      view: { step: "code", phoneNumber: "+41791234567", resendAt: START + 30_000 },
      sentPhoneNumber: "+41791234567",
    });
    await controller.verifySmsCode("+41791234567", "000000");
    expect(controller.getState().error).toBe("invalid_code");
    await controller.verifySmsCode("+41791234567", "123456");

    expect(controller.getState()).toMatchObject({
      view: { step: "complete", invite: INVITE, restored: false, method: "sms" },
      error: null,
      pending: false,
    });
    expect(repository.read()).toEqual(Result.ok({ invite: INVITE }));
    expect(listener).toHaveBeenCalled();
  });

  it("remembers a number Homegate refused outright until a code is sent", async () => {
    const { controller, verification } = setup();
    controller.chooseSms();
    verification.sendSmsCode.mockResolvedValueOnce(failure("weekly_limit_exceeded"));
    await controller.sendSmsCode("+41791234567");
    expect(controller.getState()).toMatchObject({
      error: "weekly_limit_exceeded",
      phoneRefusal: { phoneNumber: "+41791234567", code: "weekly_limit_exceeded" },
    });

    // Editing the number drops the shown error; the refusal of that number stays known.
    controller.clearError();
    expect(controller.getState()).toMatchObject({
      error: null,
      phoneRefusal: { phoneNumber: "+41791234567" },
    });

    // A passing problem with the service is no refusal of the number.
    verification.sendSmsCode.mockResolvedValueOnce(failure("rate_limited"));
    await controller.sendSmsCode("+41790000000");
    expect(controller.getState().phoneRefusal?.phoneNumber).toBe("+41791234567");

    await controller.sendSmsCode("+41790000000");
    expect(controller.getState()).toMatchObject({ view: { step: "code" }, phoneRefusal: null });
  });

  it("unlocks Resend at once when the code expired", async () => {
    const { controller, verification } = setup();
    controller.chooseSms();
    await controller.sendSmsCode("+41791234567");
    expect(controller.getState().view).toMatchObject({ resendAt: START + 30_000 });

    vi.advanceTimersByTime(5_000);
    verification.verifySmsCode.mockResolvedValueOnce(failure("invalid_code"));
    await controller.verifySmsCode("+41791234567", "000000");
    expect(controller.getState().view).toMatchObject({ resendAt: START + 30_000 });

    verification.verifySmsCode.mockResolvedValueOnce(failure("verification_expired"));
    await controller.verifySmsCode("+41791234567", "000000");
    expect(controller.getState()).toMatchObject({
      error: "verification_expired",
      view: { step: "code", phoneNumber: "+41791234567", resendAt: START + 5_000 },
    });
    // Coming back to the same number reuses the unlocked challenge, not the old countdown.
    controller.back();
    controller.continueWithPhone("+41791234567");
    expect(controller.getState().view).toMatchObject({ resendAt: START + 5_000 });
  });

  it("prevents duplicate sends and ignores a late response after going back", async () => {
    const { controller, verification } = setup();
    let finish!: () => void;
    verification.sendSmsCode.mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve(Result.ok()))),
    );

    const pending = controller.sendSmsCode("+41791234567");
    await controller.sendSmsCode("+41791234567");
    expect(verification.sendSmsCode).toHaveBeenCalledOnce();
    controller.back();
    expect(verification.sendSmsCode.mock.calls[0]?.[1].aborted).toBe(true);
    finish();
    await pending;

    expect(controller.getState()).toMatchObject({ view: { step: "choose" }, pending: false });
  });

  it("returns from code entry to the same phone and reuses its SMS challenge", async () => {
    const { controller, verification } = setup();
    controller.chooseSms();
    await controller.sendSmsCode("+41791234567");
    const challenge = controller.getState().view;

    controller.back();
    expect(controller.getState().view).toEqual({ step: "phone", phoneNumber: "+41791234567" });
    controller.continueWithPhone("+41791234567");
    expect(controller.getState().view).toEqual(challenge);
    expect(verification.sendSmsCode).toHaveBeenCalledOnce();

    controller.back();
    controller.back();
    expect(controller.getState().view).toEqual({ step: "choose" });
    controller.chooseSms();
    expect(controller.getState().view).toEqual({ step: "phone", phoneNumber: "+41791234567" });
    controller.continueWithPhone("+41797654321");
    await vi.waitFor(() => expect(verification.sendSmsCode).toHaveBeenCalledTimes(2));
  });

  it("polls the same invoice through a network failure until the payment is confirmed", async () => {
    const { controller, verification, repository } = setup();
    verification.checkLightningPayment
      .mockResolvedValueOnce(failure("network_failed"))
      .mockResolvedValueOnce(paid());

    await controller.createInvoice();
    expect(controller.getState().view).toEqual({
      step: "lightning",
      invoice: INVOICE,
      expired: false,
    });
    expect(repository.read()).toEqual(Result.ok({ invoice: INVOICE }));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState().error).toBe("network_failed");
    await vi.advanceTimersByTimeAsync(3_000);

    expect(controller.getState()).toMatchObject({
      // A paid invoice issued it, so the choice that follows can say the payment was received.
      view: { step: "complete", invite: INVITE, restored: false, method: "lightning" },
      error: null,
    });
    expect(repository.read()).toEqual(Result.ok({ invite: INVITE }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(verification.checkLightningPayment).toHaveBeenCalledTimes(2);
  });

  it("stops polling on Back and on dispose, and resumes on start", async () => {
    const { controller, verification } = setup();
    await controller.createInvoice();
    await vi.advanceTimersByTimeAsync(0);
    controller.back();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(verification.checkLightningPayment).toHaveBeenCalledTimes(1);
    expect(controller.getState().view.step).toBe("choose");

    await controller.createInvoice();
    await vi.advanceTimersByTimeAsync(0);
    expect(verification.checkLightningPayment).toHaveBeenCalledTimes(2);
    controller.dispose();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(verification.checkLightningPayment).toHaveBeenCalledTimes(2);
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(verification.checkLightningPayment).toHaveBeenCalledTimes(3);
  });

  it("returns from Back to the same unexpired invoice without minting another", async () => {
    const { controller, verification } = setup();
    await controller.createInvoice();
    controller.back();
    await controller.createInvoice();

    expect(controller.getState().view).toEqual({
      step: "lightning",
      invoice: INVOICE,
      expired: false,
    });
    expect(verification.createLightningInvoice).toHaveBeenCalledOnce();
  });

  it("checks an expired invoice for a late payment before minting a replacement", async () => {
    const { controller, verification, repository } = setup();
    verification.createLightningInvoice
      .mockResolvedValueOnce(Result.ok(EXPIRING))
      .mockResolvedValueOnce(Result.ok(REPLACEMENT));
    await controller.createInvoice();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(controller.getState().view).toMatchObject({ step: "lightning", expired: true });

    controller.back();
    await controller.createInvoice();

    expect(controller.getState().view).toMatchObject({
      step: "lightning",
      invoice: REPLACEMENT,
      expired: false,
    });
    expect(verification.checkLightningPayment.mock.calls.at(-1)?.[0]).toBe(EXPIRING.id);
    expect(verification.createLightningInvoice).toHaveBeenCalledTimes(2);
    expect(repository.read()).toEqual(Result.ok({ invoice: REPLACEMENT }));
  });

  it("mints a replacement when Homegate no longer knows the expired invoice", async () => {
    const { controller, verification } = setup();
    verification.createLightningInvoice
      .mockResolvedValueOnce(Result.ok(EXPIRING))
      .mockResolvedValueOnce(Result.ok(REPLACEMENT));
    await controller.createInvoice();
    await vi.advanceTimersByTimeAsync(3_000);
    verification.checkLightningPayment.mockResolvedValueOnce(failure("verification_expired"));

    await controller.createInvoice();

    expect(controller.getState().view).toMatchObject({ invoice: REPLACEMENT, expired: false });
  });

  it("drops an invoice Homegate reports as unknown, so the next invoice is fresh", async () => {
    const { controller, verification, storage } = setup();
    verification.createLightningInvoice
      .mockResolvedValueOnce(Result.ok(INVOICE))
      .mockResolvedValueOnce(Result.ok(REPLACEMENT));
    verification.checkLightningPayment.mockResolvedValueOnce(failure("verification_expired"));
    await controller.createInvoice();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState().view).toMatchObject({ invoice: INVOICE, expired: true });
    expect(storage.length).toBe(0);

    await controller.createInvoice();

    expect(verification.checkLightningPayment).toHaveBeenCalledOnce();
    expect(controller.getState().view).toMatchObject({ invoice: REPLACEMENT, expired: false });
  });

  it.each(["homegate_unavailable", "rate_limited", "network_failed", "blocked"] as const)(
    "keeps a possibly paid expired invoice when the late-payment check fails with %s",
    async (code) => {
      const { controller, verification, repository } = setup();
      verification.createLightningInvoice.mockResolvedValueOnce(Result.ok(EXPIRING));
      verification.checkLightningPayment.mockResolvedValue(failure("homegate_unavailable"));
      await controller.createInvoice();
      await vi.advanceTimersByTimeAsync(3_000);
      expect(controller.getState().view).toMatchObject({ invoice: EXPIRING, expired: true });

      verification.checkLightningPayment.mockResolvedValueOnce(failure(code));
      const pending = controller.createInvoice();
      expect(controller.getState().view).toMatchObject({ invoice: EXPIRING, expired: true });
      await pending;

      expect(verification.createLightningInvoice).toHaveBeenCalledOnce();
      expect(controller.getState()).toMatchObject({
        view: { step: "lightning", invoice: EXPIRING, expired: true },
        error: code,
      });
      expect(repository.read()).toEqual(Result.ok({ invoice: EXPIRING }));

      verification.checkLightningPayment.mockResolvedValueOnce(paid());
      await controller.checkPayment(EXPIRING);
      expect(controller.getState().view).toMatchObject({ step: "complete", invite: INVITE });
    },
  );

  it("completes from an expired invoice that turns out to be paid instead of minting", async () => {
    const { controller, verification } = setup();
    verification.createLightningInvoice.mockResolvedValueOnce(Result.ok(EXPIRING));
    await controller.createInvoice();
    await vi.advanceTimersByTimeAsync(3_000);
    verification.checkLightningPayment.mockResolvedValueOnce(paid());

    await controller.createInvoice();

    expect(controller.getState().view).toMatchObject({
      step: "complete",
      invite: INVITE,
      method: "lightning",
    });
    expect(verification.createLightningInvoice).toHaveBeenCalledOnce();
  });

  it.each([
    ["blocked", false],
    ["verification_expired", true],
  ] as const)("stops polling on %s", async (code, expired) => {
    const { controller, verification } = setup();
    verification.checkLightningPayment.mockResolvedValue(failure(code));
    await controller.createInvoice();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(verification.checkLightningPayment).toHaveBeenCalledOnce();
    expect(controller.getState()).toMatchObject({
      view: { step: "lightning", expired },
      error: code,
    });
  });

  it("backs off exponentially while the service is rate limited and recovers afterwards", async () => {
    const { controller, verification } = setup();
    verification.checkLightningPayment
      .mockResolvedValueOnce(failure("rate_limited"))
      .mockResolvedValueOnce(failure("rate_limited"))
      .mockResolvedValueOnce(failure("rate_limited"));
    await controller.createInvoice();
    const checks = () => verification.checkLightningPayment.mock.calls.length;

    await vi.advanceTimersByTimeAsync(0);
    expect(checks()).toBe(1);
    expect(controller.getState().error).toBe("rate_limited");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(checks()).toBe(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(checks()).toBe(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(checks()).toBe(3);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(checks()).toBe(3);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(checks()).toBe(4);
    expect(controller.getState().error).toBeNull();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(checks()).toBe(5);
  });

  it("reports an unconfirmed manual payment check, then completes once paid", async () => {
    const { controller, verification } = setup();
    verification.createLightningInvoice.mockResolvedValueOnce(Result.ok(EXPIRING));
    await controller.createInvoice();
    await vi.advanceTimersByTimeAsync(3_000);

    await controller.checkPayment(EXPIRING);
    expect(controller.getState().error).toBe("payment_not_confirmed");
    verification.checkLightningPayment.mockResolvedValueOnce(paid());
    await controller.checkPayment(EXPIRING);
    expect(controller.getState().view).toMatchObject({ step: "complete" });
    expect(verification.createLightningInvoice).toHaveBeenCalledOnce();
  });

  it("forgets a rejected invite and its paid invoice, so Lightning mints a fresh invoice", async () => {
    const { controller, verification, storage } = setup();
    verification.checkLightningPayment.mockResolvedValueOnce(paid());
    await controller.createInvoice();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState().view.step).toBe("complete");

    controller.forget();
    expect(controller.getState()).toMatchObject({ view: { step: "choose" }, error: null });
    expect(storage.length).toBe(0);
    verification.createLightningInvoice.mockResolvedValueOnce(Result.ok(REPLACEMENT));
    await controller.createInvoice();

    expect(verification.createLightningInvoice).toHaveBeenCalledTimes(2);
    expect(controller.getState().view).toMatchObject({ invoice: REPLACEMENT });
  });

  it("notes a refused invite until a method is chosen again", async () => {
    const { controller, verification, storage } = setup();
    await controller.verifySmsCode("+41791234567", "123456");

    controller.forget({ refused: true });
    expect(controller.getState()).toMatchObject({
      view: { step: "choose" },
      verificationRefused: true,
    });
    expect(storage.length).toBe(0);
    controller.chooseSms();
    expect(controller.getState().verificationRefused).toBe(false);

    controller.back();
    controller.forget({ refused: true });
    await controller.createInvoice();
    expect(verification.createLightningInvoice).toHaveBeenCalledOnce();
    expect(controller.getState().verificationRefused).toBe(false);

    controller.back();
    controller.forget({ refused: true });
    // An invite code is chosen outside this controller, which only drops the note.
    controller.dismissRefusal();
    expect(controller.getState()).toMatchObject({
      view: { step: "choose" },
      verificationRefused: false,
    });
    // Forgetting for any other reason adds no note.
    controller.forget();
    expect(controller.getState().verificationRefused).toBe(false);
  });

  it("releases a redeemed invite from storage without changing the screen", async () => {
    const { controller, storage } = setup();
    await controller.verifySmsCode("+41791234567", "123456");
    controller.releaseInvite();

    expect(storage.length).toBe(0);
    expect(controller.getState().view).toMatchObject({ step: "complete", invite: INVITE });
  });

  it("keeps an open invoice when SMS issues the invite, since it may have been paid too", async () => {
    const { controller, verification, repository, storage } = setup();
    await controller.createInvoice();
    controller.back();
    controller.chooseSms();
    await controller.verifySmsCode("+41791234567", "123456");
    expect(repository.read()).toEqual(Result.ok({ invoice: INVOICE, invite: INVITE }));

    controller.releaseInvite();

    expect(repository.read()).toEqual(Result.ok({ invoice: INVOICE }));
    const reopened = setup(storage);
    expect(reopened.controller.getState().view).toEqual({
      step: "lightning",
      invoice: INVOICE,
      expired: false,
    });
    expect(verification.createLightningInvoice).toHaveBeenCalledOnce();
  });

  it("does not step back from an issued invite", async () => {
    const { controller } = setup();
    await controller.verifySmsCode("+41791234567", "123456");
    controller.back();
    expect(controller.getState().view.step).toBe("complete");
  });

  describe("after a reload or cancelled setup", () => {
    it("restores an issued invite without asking Homegate again", () => {
      const storage = new MemoryStorage();
      new HomegateSignupRepository(() => storage).saveInvite(INVITE);
      const { controller, verification } = setup(storage);

      expect(controller.getState().view).toEqual({
        step: "complete",
        invite: INVITE,
        restored: true,
      });
      controller.start();
      expect(verification.checkLightningPayment).not.toHaveBeenCalled();
    });

    it("offers the invoice kept next to a restored invite once that invite is forgotten", async () => {
      const storage = new MemoryStorage();
      const saved = new HomegateSignupRepository(() => storage);
      saved.saveInvoice(INVOICE);
      saved.saveInvite(INVITE);
      const { controller, verification, repository } = setup(storage);
      expect(controller.getState().view).toEqual({
        step: "complete",
        invite: INVITE,
        restored: true,
      });

      controller.forget();
      expect(repository.read()).toEqual(Result.ok({ invoice: INVOICE }));
      await controller.createInvoice();

      expect(verification.createLightningInvoice).not.toHaveBeenCalled();
      expect(controller.getState().view).toEqual({
        step: "lightning",
        invoice: INVOICE,
        expired: false,
      });
    });

    it("resumes polling an open invoice once started", async () => {
      const storage = new MemoryStorage();
      new HomegateSignupRepository(() => storage).saveInvoice(INVOICE);
      const { controller, verification } = setup(storage);
      verification.checkLightningPayment.mockResolvedValueOnce(paid());
      expect(controller.getState().view).toEqual({
        step: "lightning",
        invoice: INVOICE,
        expired: false,
      });

      controller.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(verification.checkLightningPayment).toHaveBeenCalledWith(
        INVOICE.id,
        expect.any(AbortSignal),
      );
      expect(controller.getState().view).toMatchObject({ step: "complete", invite: INVITE });
      expect(verification.createLightningInvoice).not.toHaveBeenCalled();
    });

    it("checks an invoice that expired meanwhile before charging again", async () => {
      const storage = new MemoryStorage();
      new HomegateSignupRepository(() => storage).saveInvoice(EXPIRING);
      vi.setSystemTime(EXPIRING.expiresAt + 1);
      const { controller, verification } = setup(storage);
      expect(controller.getState().view).toEqual({ step: "choose" });
      verification.checkLightningPayment.mockResolvedValueOnce(paid());

      await controller.createInvoice();

      expect(verification.checkLightningPayment.mock.calls[0]?.[0]).toBe(EXPIRING.id);
      expect(controller.getState().view).toMatchObject({ step: "complete", invite: INVITE });
      expect(verification.createLightningInvoice).not.toHaveBeenCalled();
    });

    it("discards a stored record it cannot read", () => {
      const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const storage = new MemoryStorage();
      storage.setItem("pubky-passport/homegate-signup/v1", "not json");
      const { controller } = setup(storage);

      expect(controller.getState().view).toEqual({ step: "choose" });
      expect(storage.length).toBe(0);
      expect(warn).toHaveBeenCalledWith("signup.homegate.storage_failed", {
        operation: "restore",
        code: "invalid_record",
      });
    });
  });

  it("still completes when the invite cannot be kept in storage", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const storage = new MemoryStorage();
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const { controller } = setup(storage);

    await controller.verifySmsCode("+41791234567", "123456");

    expect(controller.getState().view).toMatchObject({ step: "complete", invite: INVITE });
    expect(warn).toHaveBeenCalledWith(
      "signup.homegate.storage_failed",
      expect.objectContaining({ operation: "save_invite", code: "storage_unavailable" }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(INVITE.signupToken);
  });

  it("reports every request as unavailable on an instance without Homegate", async () => {
    const controller = new HomegateSignupController(
      null,
      new HomegateSignupRepository(() => new MemoryStorage()),
    );
    await controller.createInvoice();
    expect(controller.getState()).toMatchObject({
      view: { step: "lightning", invoice: null },
      error: "homegate_unavailable",
      pending: false,
    });
  });
});
