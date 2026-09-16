import "client-only";

import { Result } from "better-result";
import { z } from "zod";

import { HomegateTransport, type HomegateFailure } from "./HomegateTransport";
import {
  homegateSignupSchema,
  signupDetails,
  type HomeserverSignupDetails,
} from "./homegateSignup";

export const phoneNumberSchema = z.string().regex(/^\+[1-9]\d{1,14}$/);
export const smsCodeSchema = z.string().regex(/^\d{6}$/);
const verificationIdSchema = z.uuid();
const invoiceSchema = z.object({
  id: verificationIdSchema,
  bolt11Invoice: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^ln(?:bc|tb|bcrt)[0-9a-z]+$/i),
  amountSat: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expiresAt: z.number().int().positive().max(8_640_000_000_000_000),
});
const smsResponseSchema = z.union([
  homegateSignupSchema
    .extend({ valid: z.union([z.literal("true"), z.literal(true)]) })
    .transform(signupDetails),
  z.object({ valid: z.union([z.literal("false"), z.literal(false)]) }).transform(() => null),
]);
const paymentSchema = z.discriminatedUnion("isPaid", [
  homegateSignupSchema.extend({ isPaid: z.literal(true), id: verificationIdSchema }),
  z.object({ isPaid: z.literal(false), id: verificationIdSchema }),
]);

export type LightningInvoice = z.infer<typeof invoiceSchema>;
type VerificationErrorCode =
  | "invalid_phone_number"
  | "invalid_code"
  | "blocked"
  | "rate_limited"
  | "weekly_limit_exceeded"
  | "annual_limit_exceeded"
  | "verification_expired"
  | "homegate_unavailable";
export type HomegateVerificationFailure = HomegateFailure<VerificationErrorCode>;

/** Obtains invites only. Account keys and client authorization remain with the authenticator. */
export class HomegateVerificationClient {
  private readonly transport: HomegateTransport<VerificationErrorCode>;

  constructor(homegateBaseUrl: string, fetch: typeof globalThis.fetch) {
    this.transport = new HomegateTransport(
      homegateBaseUrl,
      fetch,
      "signup.homegate.failed",
      mapVerificationError,
    );
  }

  async sendSmsCode(
    phoneNumber: string,
    signal: AbortSignal,
  ): Promise<Result<void, HomegateVerificationFailure>> {
    if (!phoneNumberSchema.safeParse(phoneNumber).success) {
      return Result.err({ code: "invalid_phone_number" as const });
    }
    return this.transport.request("/sms_verification/send_code", "send_sms_code", z.undefined(), {
      body: { phoneNumber },
      signal,
      empty: true,
    });
  }

  async verifySmsCode(
    phoneNumber: string,
    code: string,
    signal: AbortSignal,
  ): Promise<Result<HomeserverSignupDetails, HomegateVerificationFailure>> {
    if (!phoneNumberSchema.safeParse(phoneNumber).success) {
      return Result.err({ code: "invalid_phone_number" as const });
    }
    if (!smsCodeSchema.safeParse(code).success)
      return Result.err({ code: "invalid_code" as const });
    const result = await this.transport.request(
      "/sms_verification/validate_code",
      "verify_sms_code",
      smsResponseSchema,
      { body: { phoneNumber, code }, signal },
    );
    if (Result.isError(result)) return Result.err(result.error);
    return result.value ? Result.ok(result.value) : Result.err({ code: "invalid_code" as const });
  }

  createLightningInvoice(signal: AbortSignal) {
    return this.transport.request("/ln_verification", "create_lightning_invoice", invoiceSchema, {
      signal,
    });
  }

  async checkLightningPayment(
    id: string,
    signal: AbortSignal,
  ): Promise<Result<HomeserverSignupDetails | null, HomegateVerificationFailure>> {
    if (!verificationIdSchema.safeParse(id).success) {
      return Result.err({ code: "verification_expired" as const });
    }
    const result = await this.transport.request(
      `/ln_verification/${id}`,
      "check_lightning_payment",
      paymentSchema,
      { method: "GET", signal },
    );
    if (Result.isError(result)) return Result.err(result.error);
    if (result.value.id !== id) return Result.err({ code: "malformed_homegate_response" as const });
    return Result.ok(result.value.isPaid ? signupDetails(result.value) : null);
  }
}

function mapVerificationError(body: string, status: number): VerificationErrorCode {
  switch (body.trim()) {
    case "Phone number has exceeded weekly verification limit":
      return "weekly_limit_exceeded";
    case "Phone number has exceeded annual verification limit":
      return "annual_limit_exceeded";
    case "No active verification session for phone number":
    case "Too many incorrect code attempts. Please request a new verification code.":
      return "verification_expired";
  }
  switch (status) {
    case 403:
      return "blocked";
    case 429:
      return "rate_limited";
    case 404:
      return "verification_expired";
    case 422:
      return "invalid_phone_number";
    default:
      return "homegate_unavailable";
  }
}
