import "client-only";

import { Result, type Result as ResultType } from "better-result";
import { z } from "zod";

import type { CodedFailure } from "@/libs/result";
import {
  homeserverPubkySchema,
  signupTokenSchema,
  type HomeserverSignupDetails,
} from "@/client/logic/signup/homeserverInvite";
import { lightningInvoiceSchema, type LightningInvoice } from "./HomegateVerificationClient";

const STORAGE_KEY = "pubky-passport/homegate-signup/v1";
const storedSchema = z.strictObject({
  v: z.literal(1),
  invoice: lightningInvoiceSchema.strict().optional(),
  invite: z
    .strictObject({ signupToken: signupTokenSchema, homeserverPubky: homeserverPubkySchema })
    .optional(),
});
type StoredSignup = z.infer<typeof storedSchema>;

/**
 * What verification left behind: an invoice that may still be paid, the issued invite, or both
 * when SMS issued the invite while an earlier invoice was still open.
 */
export type PendingHomegateSignup = {
  invoice?: LightningInvoice;
  invite?: HomeserverSignupDetails;
};
type SignupResult<T> = ResultType<T, CodedFailure<"storage_unavailable" | "invalid_record">>;

/**
 * Keeps what a Homegate verification cost the user across reloads, cancelled setups, and
 * closed popups: the open Lightning invoice until it pays out, and the issued invite until an
 * account owns it. Each is removed on its own. SMS challenges and phone numbers are never stored.
 */
export class HomegateSignupRepository {
  constructor(private readonly storage: () => Storage = () => globalThis.localStorage) {}

  read(): SignupResult<PendingHomegateSignup | null> {
    let raw: string | null;
    try {
      raw = this.storage().getItem(STORAGE_KEY);
    } catch (e) {
      return Result.err({ code: "storage_unavailable", cause: e });
    }
    if (raw === null) return Result.ok(null);
    try {
      const parsed = storedSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return Result.err({ code: "invalid_record" });
      const { invoice, invite } = parsed.data;
      return Result.ok({ ...(invoice ? { invoice } : {}), ...(invite ? { invite } : {}) });
    } catch {
      // Parser errors can echo the stored invite. Do not retain their messages.
      return Result.err({ code: "invalid_record" });
    }
  }

  /** Stores the open invoice next to any issued invite. */
  saveInvoice(invoice: LightningInvoice): SignupResult<void> {
    return this.change(({ invite }) => ({ invoice, ...(invite ? { invite } : {}) }));
  }

  /**
   * Stores the issued invite. The invoice that paid for it (`paidInvoiceId`) is dropped; any
   * other stored invoice is kept, since it may have been paid as well.
   */
  saveInvite(invite: HomeserverSignupDetails, paidInvoiceId?: string): SignupResult<void> {
    return this.change(({ invoice }) => ({ invite, ...keptInvoice(invoice, paidInvoiceId) }));
  }

  /** Drops the stored invoice if it is `invoiceId`; an issued invite stays. */
  removeInvoice(invoiceId: string): SignupResult<void> {
    return this.change(({ invoice, invite }) => ({
      ...keptInvoice(invoice, invoiceId),
      ...(invite ? { invite } : {}),
    }));
  }

  /** Drops the issued invite; an open invoice stays. */
  removeInvite(): SignupResult<void> {
    return this.change(({ invoice }) => (invoice ? { invoice } : {}));
  }

  clear(): SignupResult<void> {
    try {
      this.storage().removeItem(STORAGE_KEY);
      return Result.ok();
    } catch (e) {
      return Result.err({ code: "storage_unavailable", cause: e });
    }
  }

  /** Rewrites the record from its current content; an unreadable record counts as empty. */
  private change(
    next: (current: PendingHomegateSignup) => PendingHomegateSignup,
  ): SignupResult<void> {
    const current = this.read();
    if (Result.isError(current) && current.error.code === "storage_unavailable")
      return Result.err(current.error);
    const pending = next((Result.isOk(current) && current.value) || {});
    if (!pending.invoice && !pending.invite) return this.clear();
    return this.write({ v: 1, ...pending });
  }

  private write(stored: StoredSignup): SignupResult<void> {
    if (!storedSchema.safeParse(stored).success) return Result.err({ code: "invalid_record" });
    try {
      this.storage().setItem(STORAGE_KEY, JSON.stringify(stored));
      return Result.ok();
    } catch (e) {
      return Result.err({ code: "storage_unavailable", cause: e });
    }
  }
}

function keptInvoice(
  invoice: LightningInvoice | undefined,
  droppedId: string | undefined,
): { invoice?: LightningInvoice } {
  return invoice && invoice.id !== droppedId ? { invoice } : {};
}
