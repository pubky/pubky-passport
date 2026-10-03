import { describe, expect, it } from "vitest";

import { MemoryStorage } from "@test-utils/MemoryStorage";
import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";
import { HomegateSignupRepository } from "./HomegateSignupRepository";

const KEY = "pubky-passport/homegate-signup/v1";
const INVOICE = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  amountSat: 1000,
  bolt11Invoice: "lnbc10u1example",
  expiresAt: 1_900_000_000_000,
};
const INVITE = {
  signupToken: "AB12-CD34-EF56",
  homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
};

describe("HomegateSignupRepository", () => {
  it("replaces the invoice with the invite it paid for", () => {
    const storage = new MemoryStorage();
    const repository = new HomegateSignupRepository(() => storage);
    expect(expectResultOk(repository.read())).toBeNull();

    expectResultOk(repository.saveInvoice(INVOICE));
    expect(expectResultOk(new HomegateSignupRepository(() => storage).read())).toEqual({
      invoice: INVOICE,
    });

    expectResultOk(repository.saveInvite(INVITE, INVOICE.id));
    expect(expectResultOk(repository.read())).toEqual({ invite: INVITE });
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual({ v: 1, invite: INVITE });

    expectResultOk(repository.clear());
    expect(storage.length).toBe(0);
  });

  it("keeps an open invoice next to an invite it did not pay for", () => {
    const storage = new MemoryStorage();
    const repository = new HomegateSignupRepository(() => storage);
    expectResultOk(repository.saveInvoice(INVOICE));
    expectResultOk(repository.saveInvite(INVITE));
    expect(expectResultOk(repository.read())).toEqual({ invoice: INVOICE, invite: INVITE });

    expectResultOk(repository.removeInvite());
    expect(expectResultOk(repository.read())).toEqual({ invoice: INVOICE });

    expectResultOk(repository.saveInvite(INVITE));
    expectResultOk(repository.removeInvoice("7c9e6679-7425-40de-944b-e07fc1f90ae7"));
    expect(expectResultOk(repository.read())).toEqual({ invoice: INVOICE, invite: INVITE });
    expectResultOk(repository.removeInvoice(INVOICE.id));
    expect(expectResultOk(repository.read())).toEqual({ invite: INVITE });

    expectResultOk(repository.removeInvite());
    expect(storage.length).toBe(0);
  });

  it("replaces a record it cannot read when saving", () => {
    const storage = new MemoryStorage();
    storage.setItem(KEY, "not json");
    const repository = new HomegateSignupRepository(() => storage);
    expectResultOk(repository.saveInvoice(INVOICE));
    expect(expectResultOk(repository.read())).toEqual({ invoice: INVOICE });
  });

  it.each([
    "not json",
    JSON.stringify({ v: 2, invite: INVITE }),
    JSON.stringify({ v: 1, invite: { ...INVITE, homeserverPubky: "invalid" } }),
    JSON.stringify({ v: 1, invite: INVITE, phoneNumber: "+41791234567" }),
  ])("rejects a stored record it did not write: %s", (raw) => {
    const storage = new MemoryStorage();
    storage.setItem(KEY, raw);
    const result = new HomegateSignupRepository(() => storage).read();
    expectResultError(result, { code: "invalid_record" });
    expect(JSON.stringify(result)).not.toContain(INVITE.signupToken);
  });

  it("refuses to write an invite that is not a valid homeserver invite", () => {
    const storage = new MemoryStorage();
    expectResultError(
      new HomegateSignupRepository(() => storage).saveInvite({ ...INVITE, signupToken: " " }),
      { code: "invalid_record" },
    );
    expect(storage.length).toBe(0);
  });

  it("reports unavailable storage instead of throwing", () => {
    const failure = new DOMException("blocked", "SecurityError");
    const repository = new HomegateSignupRepository(() => {
      throw failure;
    });
    expectResultError(repository.read(), { code: "storage_unavailable", cause: failure });
    expectResultError(repository.saveInvoice(INVOICE), {
      code: "storage_unavailable",
      cause: failure,
    });
    expectResultError(repository.removeInvite(), { code: "storage_unavailable", cause: failure });
    expectResultError(repository.clear(), { code: "storage_unavailable", cause: failure });
  });
});
