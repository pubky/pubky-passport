import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "@/libs/logger/logger";
import { SignupTokenChecker } from "./SignupTokenChecker";

vi.mock("./PubkySdkAdapter", () => ({ fetchHomeserver: vi.fn() }));

const INVITE = {
  homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
  signupToken: "AB12-CD34/?",
};

function checkWith(response: Response | Error) {
  const fetch = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return {
    fetch,
    result: new SignupTokenChecker(fetch).check(INVITE, new AbortController().signal),
  };
}

describe("SignupTokenChecker", () => {
  afterEach(() => vi.restoreAllMocks());

  it("looks the encoded token up on the homeserver addressed by its key", async () => {
    const { fetch, result } = checkWith(Response.json({ status: "valid" }));

    expect(await result).toBe("valid");
    expect(fetch).toHaveBeenCalledWith(
      `https://${INVITE.homeserverPubky}/signup_tokens/AB12-CD34%2F%3F`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it.each([
    [new Response("Token not found", { status: 404 }), "not_found"],
    [Response.json({ status: "used", created_at: "2026-01-01T00:00:00Z" }), "used"],
    [Response.json({ status: "valid", created_at: "2026-01-01T00:00:00Z" }), "valid"],
  ] as const)("maps a %# homeserver answer to %s", async (response, expected) => {
    expect(await checkWith(response).result).toBe(expected);
  });

  it.each([
    ["an unexpected status", new Response("", { status: 500 })],
    ["a transport failure", new TypeError("offline")],
    ["a body that is not JSON", new Response("not json", { status: 200 })],
    ["an undocumented body", Response.json({ used: true, used_by: "some-pubky" })],
    ["an unknown status", Response.json({ status: "expired" })],
    ["an oversized body", new Response("x".repeat(4097), { status: 200 })],
  ])("reports %s as unknown instead of judging the invite", async (_label, response) => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    expect(await checkWith(response).result).toBe("unknown");
    expect(warn).toHaveBeenCalledWith("signup.invite_check.failed", expect.any(Object));
    expect(JSON.stringify(warn.mock.calls)).not.toContain(INVITE.signupToken);
  });

  it.each([
    ["a documented answer", Response.json({ status: "used" }), { status: "used", reached: true }],
    ["a 404", new Response("", { status: 404 }), { status: "not_found", reached: true }],
    ["an error status", new Response("", { status: 503 }), { status: "unknown", reached: true }],
    [
      "a transport failure",
      new TypeError("Failed to fetch"),
      { status: "unknown", reached: false },
    ],
  ] as const)("tells whether the homeserver answered: %s", async (_label, response, expected) => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const fetch = vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    expect(
      await new SignupTokenChecker(fetch).lookUp(INVITE, new AbortController().signal),
    ).toEqual(expected);
  });

  it.each([
    ["a 404 for the probe code", new Response("", { status: 404 }), true],
    ["an error status", new Response("", { status: 503 }), true],
    ["a transport failure", new TypeError("Failed to fetch"), false],
  ] as const)("says a homeserver answers after %s", async (_label, response, expected) => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const fetch = vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    expect(
      await new SignupTokenChecker(fetch).reaches(
        INVITE.homeserverPubky,
        new AbortController().signal,
      ),
    ).toBe(expected);
    // The same read-only lookup, for a placeholder code.
    expect(fetch).toHaveBeenCalledWith(
      `https://${INVITE.homeserverPubky}/signup_tokens/0000-0000-0000`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("reports a cancelled lookup as unanswered without logging it", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cancelled = new AbortController();
    const fetch = vi.fn(async () => {
      cancelled.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    expect(await new SignupTokenChecker(fetch).lookUp(INVITE, cancelled.signal)).toEqual({
      status: "unknown",
      reached: false,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
