import "client-only";

import { Result } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { HomeserverSignupDetails } from "@/client/logic/signup/homeserverInvite";
import { HomegateSignupRepository } from "./HomegateSignupRepository";
import type {
  HomegateVerificationClient,
  HomegateVerificationFailure,
  LightningInvoice,
} from "./HomegateVerificationClient";

export type HomegateSignupView =
  | { step: "choose" }
  | { step: "phone"; phoneNumber: string }
  | { step: "code"; phoneNumber: string; resendAt: number }
  | { step: "lightning"; invoice: LightningInvoice | null; expired: boolean }
  /** `restored` marks an invite issued during an earlier visit, whose later use is unknown. */
  | { step: "complete"; invite: HomeserverSignupDetails; restored: boolean };

export type HomegateSignupErrorCode = HomegateVerificationFailure["code"] | "payment_not_confirmed";

export type HomegateSignupState = {
  view: HomegateSignupView;
  pending: boolean;
  error: HomegateSignupErrorCode | null;
  /** The number the current SMS challenge went to; continuing with it reuses the challenge. */
  sentPhoneNumber: string | undefined;
};

type VerificationPort = Pick<
  HomegateVerificationClient,
  "checkLightningPayment" | "createLightningInvoice" | "sendSmsCode" | "verifySmsCode"
>;
type StoragePort = Pick<
  HomegateSignupRepository,
  "clear" | "read" | "removeInvite" | "removeInvoice" | "saveInvite" | "saveInvoice"
>;
type VerificationResult<T> = Result<T, HomegateVerificationFailure>;
/** Runs `callback` after `delayMs` and returns a function that cancels it. */
export type Scheduler = (callback: () => void, delayMs: number) => () => void;

type LatePaymentOutcome =
  | { kind: "paid"; invite: HomeserverSignupDetails }
  | { kind: "invoice"; invoice: LightningInvoice };

const POLL_INTERVAL_MS = 3_000;
const MAXIMUM_POLL_INTERVAL_MS = 30_000;
const SMS_RESEND_DELAY_MS = 30_000;
/** Homegate will not change its answer for these; polling on would only repeat the error. */
const TERMINAL_POLL_CODES = new Set<HomegateSignupErrorCode>(["blocked", "verification_expired"]);
/** Transient answers slow the poll down rather than hammering a struggling service. */
const BACKOFF_POLL_CODES = new Set<HomegateSignupErrorCode>(["rate_limited", "network_failed"]);

const scheduleTimeout: Scheduler = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

/**
 * Drives SMS and Lightning verification until Homegate issues an invite. It obtains invites
 * only; account keys and client authorization stay with the chosen signer.
 *
 * One request runs at a time and leaving a step aborts it. A Lightning payment and an SMS
 * verification both cost the user something, so the open invoice and the issued invite are
 * kept in browser storage across reloads and cancelled setups. The invite is dropped only
 * through {@link forget} or, once an account owns it, {@link releaseInvite}. An invoice is
 * dropped only once it paid for an invite or Homegate no longer knows it; an SMS invite leaves
 * an earlier invoice in place, since it may have been paid as well.
 */
export class HomegateSignupController {
  private state: HomegateSignupState;
  private readonly listeners = new Set<() => void>();
  private operation: AbortController | null = null;
  private polling: { invoiceId: string; stop: () => void } | null = null;
  private phoneNumber = "";
  private smsChallenge: { phoneNumber: string; resendAt: number } | null = null;
  // The last invoice survives Back, reloads, and other invites so Lightning never charges twice.
  private lastInvoice: LightningInvoice | null = null;

  /** @param verification `null` when this instance has no Homegate; every request then fails. */
  constructor(
    private readonly verification: VerificationPort | null,
    private readonly storage: StoragePort = new HomegateSignupRepository(),
    private readonly now: () => number = Date.now,
    private readonly schedule: Scheduler = scheduleTimeout,
  ) {
    this.state = {
      view: this.restoreView(),
      pending: false,
      error: null,
      sentPhoneNumber: undefined,
    };
  }

  getState(): HomegateSignupState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Resumes polling an open invoice, including one restored from storage. */
  start(): void {
    this.syncPolling();
  }

  /** Aborts the running request and stops polling; state and storage remain for a later start. */
  dispose(): void {
    this.abortOperation();
    this.stopPolling();
  }

  /** Steps back through verification. An issued invite is left alone; see {@link forget}. */
  back(): void {
    const view = this.state.view;
    if (view.step === "complete") return;
    this.abortOperation();
    this.update({
      pending: false,
      error: null,
      view:
        view.step === "code"
          ? { step: "phone", phoneNumber: view.phoneNumber }
          : { step: "choose" },
    });
  }

  /** Drops the issued invite, e.g. after the homeserver rejected it. An open invoice stays. */
  forget(): void {
    this.abortOperation();
    this.smsChallenge = null;
    this.persist("forget", () => this.storage.removeInvite());
    this.update({
      pending: false,
      error: null,
      sentPhoneNumber: undefined,
      view: { step: "choose" },
    });
  }

  /** Stops keeping the invite once an account owns it; the view and any invoice are unchanged. */
  releaseInvite(): void {
    this.persist("release_invite", () => this.storage.removeInvite());
  }

  chooseSms(): void {
    this.update({ error: null, view: { step: "phone", phoneNumber: this.phoneNumber } });
  }

  /** Reuses the SMS challenge already sent to this number instead of sending another code. */
  continueWithPhone(phoneNumber: string): void {
    if (this.operation) return;
    const challenge = this.smsChallenge;
    if (challenge?.phoneNumber === phoneNumber) {
      this.update({ error: null, view: { step: "code", ...challenge } });
      return;
    }
    void this.sendSmsCode(phoneNumber);
  }

  sendSmsCode(phoneNumber: string): Promise<void> {
    this.phoneNumber = phoneNumber;
    return this.run(
      (client, signal) => client.sendSmsCode(phoneNumber, signal),
      () => {
        const challenge = { phoneNumber, resendAt: this.now() + SMS_RESEND_DELAY_MS };
        this.smsChallenge = challenge;
        this.update({ sentPhoneNumber: phoneNumber, view: { step: "code", ...challenge } });
      },
    );
  }

  verifySmsCode(phoneNumber: string, code: string): Promise<void> {
    return this.run(
      (client, signal) => client.verifySmsCode(phoneNumber, code, signal),
      (invite) => this.complete(invite),
    );
  }

  /**
   * Shows the open invoice, or creates one. An expired invoice may still have been paid, so it
   * is checked first. A replacement is charged only once Homegate confirms the old invoice
   * unpaid or no longer knows it; any other answer keeps the old invoice to check again.
   */
  createInvoice(): Promise<void> {
    if (this.operation) return Promise.resolve();
    const previous = this.lastInvoice;
    if (previous && this.now() < previous.expiresAt) {
      this.update({ error: null, view: { step: "lightning", invoice: previous, expired: false } });
      return Promise.resolve();
    }
    if (!previous) {
      this.update({ view: { step: "lightning", invoice: null, expired: false } });
      return this.run(
        (client, signal) => client.createLightningInvoice(signal),
        (invoice) => this.acceptInvoice(invoice),
      );
    }
    this.update({ view: { step: "lightning", invoice: previous, expired: true } });
    return this.run<LatePaymentOutcome>(
      async (client, signal) => {
        const payment = await client.checkLightningPayment(previous.id, signal);
        if (Result.isOk(payment) && payment.value)
          return Result.ok({ kind: "paid", invite: payment.value });
        if (Result.isError(payment) && payment.error.code !== "verification_expired")
          return Result.err(payment.error);
        const minted = await client.createLightningInvoice(signal);
        return Result.isError(minted)
          ? Result.err(minted.error)
          : Result.ok({ kind: "invoice", invoice: minted.value });
      },
      (outcome) =>
        outcome.kind === "paid"
          ? this.complete(outcome.invite, previous.id)
          : this.acceptInvoice(outcome.invoice),
    );
  }

  checkPayment(invoice: LightningInvoice): Promise<void> {
    return this.run(
      (client, signal) => client.checkLightningPayment(invoice.id, signal),
      (invite) =>
        invite
          ? this.complete(invite, invoice.id)
          : this.update({ error: "payment_not_confirmed" }),
    );
  }

  private async run<T>(
    request: (client: VerificationPort, signal: AbortSignal) => Promise<VerificationResult<T>>,
    complete: (value: T) => void,
  ): Promise<void> {
    if (this.operation) return;
    const controller = new AbortController();
    this.operation = controller;
    this.update({ pending: true, error: null });
    try {
      const result: VerificationResult<T> = this.verification
        ? await request(this.verification, controller.signal)
        : Result.err({ code: "homegate_unavailable" });
      if (controller.signal.aborted) return;
      if (Result.isError(result)) this.update({ error: result.error.code });
      else complete(result.value);
    } finally {
      if (this.operation === controller) {
        this.operation = null;
        this.update({ pending: false });
      }
    }
  }

  private acceptInvoice(invoice: LightningInvoice): void {
    this.lastInvoice = invoice;
    this.persist("save_invoice", () => this.storage.saveInvoice(invoice));
    this.update({
      view: { step: "lightning", invoice, expired: this.now() >= invoice.expiresAt },
    });
  }

  private dropInvoice(invoice: LightningInvoice): void {
    if (this.lastInvoice?.id !== invoice.id) return;
    this.lastInvoice = null;
    this.persist("drop_invoice", () => this.storage.removeInvoice(invoice.id));
  }

  /** `paidInvoiceId` names the invoice that paid for the invite; no other invoice is dropped. */
  private complete(invite: HomeserverSignupDetails, paidInvoiceId?: string): void {
    if (paidInvoiceId !== undefined && this.lastInvoice?.id === paidInvoiceId)
      this.lastInvoice = null;
    this.persist("save_invite", () => this.storage.saveInvite(invite, paidInvoiceId));
    this.update({ error: null, view: { step: "complete", invite, restored: false } });
  }

  private restoreView(): HomegateSignupView {
    const saved = this.storage.read();
    if (Result.isError(saved)) {
      LOGGER.warn("signup.homegate.storage_failed", {
        operation: "restore",
        code: saved.error.code,
      });
      if (saved.error.code === "invalid_record")
        this.persist("discard_invalid", () => this.storage.clear());
      return { step: "choose" };
    }
    const { invite, invoice } = saved.value ?? {};
    // An invoice kept next to an SMS invite is offered again once that invite is gone.
    this.lastInvoice = invoice ?? null;
    if (invite) return { step: "complete", invite, restored: true };
    if (!invoice) return { step: "choose" };
    // An open invoice resumes polling. An expired one waits until Lightning is chosen again,
    // which checks it for a late payment before charging again.
    return this.now() < invoice.expiresAt
      ? { step: "lightning", invoice, expired: false }
      : { step: "choose" };
  }

  private syncPolling(): void {
    const view = this.state.view;
    const invoice = view.step === "lightning" && !view.expired ? view.invoice : null;
    if (invoice && this.polling?.invoiceId === invoice.id) return;
    this.stopPolling();
    if (invoice && this.verification) this.poll(invoice, this.verification);
  }

  private poll(invoice: LightningInvoice, client: VerificationPort): void {
    const controller = new AbortController();
    let cancelTimer: () => void = () => undefined;
    let transientFailures = 0;
    const check = async () => {
      const result = await client.checkLightningPayment(invoice.id, controller.signal);
      if (controller.signal.aborted) return;
      if (Result.isOk(result) && result.value) {
        this.complete(result.value, invoice.id);
        return;
      }
      if (Result.isError(result)) {
        const code = result.error.code;
        if (TERMINAL_POLL_CODES.has(code)) {
          // Homegate no longer knows this invoice, so no invite can come from it any more.
          if (code === "verification_expired") this.dropInvoice(invoice);
          this.update({
            error: code,
            ...(code === "verification_expired"
              ? { view: { step: "lightning", invoice, expired: true } }
              : {}),
          });
          return;
        }
        this.update({ error: code });
        transientFailures = BACKOFF_POLL_CODES.has(code) ? transientFailures + 1 : 0;
      } else {
        this.update({ error: null });
        transientFailures = 0;
      }
      if (this.now() >= invoice.expiresAt) {
        this.update({ view: { step: "lightning", invoice, expired: true } });
        return;
      }
      cancelTimer = this.schedule(() => void check(), pollDelay(transientFailures));
    };
    this.polling = {
      invoiceId: invoice.id,
      stop: () => {
        controller.abort();
        cancelTimer();
      },
    };
    cancelTimer = this.schedule(() => void check(), 0);
  }

  private stopPolling(): void {
    this.polling?.stop();
    this.polling = null;
  }

  private abortOperation(): void {
    this.operation?.abort();
    this.operation = null;
  }

  private persist(
    operation: string,
    write: () => Result<void, { code: string; cause?: unknown }>,
  ): void {
    const written = write();
    if (Result.isError(written)) {
      LOGGER.warn("signup.homegate.storage_failed", {
        operation,
        code: written.error.code,
        ...(written.error.cause === undefined ? {} : safeErrorLogFields(written.error.cause)),
      });
    }
  }

  private update(patch: Partial<HomegateSignupState>): void {
    const viewChanged = patch.view !== undefined && patch.view !== this.state.view;
    this.state = { ...this.state, ...patch };
    if (viewChanged) this.syncPolling();
    for (const listener of this.listeners) listener();
  }
}

function pollDelay(transientFailures: number): number {
  if (transientFailures <= 1) return POLL_INTERVAL_MS;
  return Math.min(POLL_INTERVAL_MS * 2 ** (transientFailures - 1), MAXIMUM_POLL_INTERVAL_MS);
}
