import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { HomegateVerificationClient } from "./HomegateVerificationClient";

const HOMESERVER = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const ID = "550e8400-e29b-41d4-a716-446655440000";
const signal = () => new AbortController().signal;
const response = (body: unknown) => new Response(JSON.stringify(body));
const invite = { signupCode: "invite-code", homeserverPubky: HOMESERVER };

describe("HomegateVerificationClient", () => {
  it("sends SMS directly to Homegate and accepts its empty response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null));
    const client = new HomegateVerificationClient("https://homegate.example", fetch);
    expect(Result.isOk(await client.sendSmsCode("+41791234567", signal()))).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://homegate.example/sms_verification/send_code"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ phoneNumber: "+41791234567" }),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
      }),
    );
  });

  it("rejects malformed inputs without making a request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new HomegateVerificationClient("https://homegate.example", fetch);
    expect(await client.sendSmsCode("0791234567", signal())).toMatchObject({
      error: { code: "invalid_phone_number" },
    });
    expect(await client.verifySmsCode("+41791234567", "123", signal())).toMatchObject({
      error: { code: "invalid_code" },
    });
    expect(await client.checkLightningPayment("../google_verification", signal())).toMatchObject({
      error: { code: "verification_expired" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["true", true])(
    "accepts Homegate's SMS success flag %s and translates the invite",
    async (valid) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(response({ valid, ...invite }));
      const client = new HomegateVerificationClient("https://homegate.example", fetch);
      expect(await client.verifySmsCode("+41791234567", "012345", signal())).toEqual(
        Result.ok({ signupToken: "invite-code", homeserverPubky: HOMESERVER }),
      );
      expect(fetch).toHaveBeenCalledWith(
        new URL("https://homegate.example/sms_verification/validate_code"),
        expect.objectContaining({
          body: JSON.stringify({ phoneNumber: "+41791234567", code: "012345" }),
        }),
      );
    },
  );

  it.each(["false", false])("treats SMS flag %s as an incorrect code", async (valid) => {
    const client = new HomegateVerificationClient(
      "https://homegate.example",
      vi.fn().mockResolvedValue(response({ valid })),
    );
    expect(await client.verifySmsCode("+41791234567", "123456", signal())).toMatchObject({
      error: { code: "invalid_code" },
    });
  });

  it.each([
    [{ valid: "true", signupCode: "", homeserverPubky: HOMESERVER }],
    [{ valid: "true", signupCode: "code", homeserverPubky: "invalid" }],
    [{ valid: "true" }],
    [{ valid: "yes", ...invite }],
  ])("rejects malformed SMS invitations", async (body) => {
    const client = new HomegateVerificationClient(
      "https://homegate.example",
      vi.fn().mockResolvedValue(response(body)),
    );
    expect(await client.verifySmsCode("+41791234567", "123456", signal())).toMatchObject({
      error: { code: "malformed_homegate_response" },
    });
  });

  it.each([
    [403, "Forbidden", "blocked"],
    [429, "External service rate limit exceeded", "rate_limited"],
    [429, "Phone number has exceeded weekly verification limit", "weekly_limit_exceeded"],
    [429, "Phone number has exceeded annual verification limit", "annual_limit_exceeded"],
    [422, "No active verification session for phone number", "verification_expired"],
    [
      429,
      "Too many incorrect code attempts. Please request a new verification code.",
      "verification_expired",
    ],
    [422, "Invalid phone number format", "invalid_phone_number"],
    [500, "upstream internal detail", "homegate_unavailable"],
  ])("maps verification errors without exposing provider bodies", async (status, body, code) => {
    const client = new HomegateVerificationClient(
      "https://homegate.example",
      vi.fn().mockResolvedValue(new Response(body, { status })),
    );
    const result = await client.sendSmsCode("+41791234567", signal());
    expect(result).toMatchObject({ error: { code, httpStatus: status } });
    expect(JSON.stringify(result)).not.toContain(body);
  });

  it("creates an invoice and polls until its invite is available", async () => {
    const invoice = {
      id: ID,
      amountSat: 100,
      bolt11Invoice: "lnbc100n1example",
      expiresAt: Date.now() + 60000,
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(invoice))
      .mockResolvedValueOnce(
        response({ id: ID, isPaid: false, signupCode: null, homeserverPubky: HOMESERVER }),
      )
      .mockResolvedValueOnce(response({ id: ID, isPaid: true, ...invite }));
    const client = new HomegateVerificationClient("https://homegate.example", fetch);
    expect(await client.createLightningInvoice(signal())).toEqual(Result.ok(invoice));
    expect(await client.checkLightningPayment(ID, signal())).toEqual(Result.ok(null));
    expect(await client.checkLightningPayment(ID, signal())).toEqual(
      Result.ok({ signupToken: "invite-code", homeserverPubky: HOMESERVER }),
    );
    expect(fetch).toHaveBeenLastCalledWith(
      new URL(`https://homegate.example/ln_verification/${ID}`),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it.each([
    { id: ID, isPaid: true, signupCode: null, homeserverPubky: HOMESERVER },
    { id: "550e8400-e29b-41d4-a716-446655440001", isPaid: true, ...invite },
  ])("does not return a malformed or mismatched payment invite", async (body) => {
    const client = new HomegateVerificationClient(
      "https://homegate.example",
      vi.fn().mockResolvedValue(response(body)),
    );
    expect(await client.checkLightningPayment(ID, signal())).toMatchObject({
      error: { code: "malformed_homegate_response" },
    });
  });

  it("aborts a request when its screen is left", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const client = new HomegateVerificationClient("https://homegate.example", fetch);
    const pending = client.sendSmsCode("+41791234567", controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({ error: { code: "network_failed" } });
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
