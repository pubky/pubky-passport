// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useHomegateSignup } from "./useHomegateSignup";

const HOMESERVER = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const invoice = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  amountSat: 100,
  bolt11Invoice: "lnbc100n1example",
  expiresAt: Date.now() + 60000,
};

describe("useHomegateSignup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("advances through SMS verification and returns the invite", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null))
      .mockResolvedValueOnce(Response.json({ valid: "false" }))
      .mockResolvedValueOnce(
        Response.json({ valid: "true", homeserverPubky: HOMESERVER, signupCode: "invite" }),
      );
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useHomegateSignup("https://homegate.example"));
    act(() => result.current.chooseSms());
    expect(result.current.view.step).toBe("phone");
    await act(() => result.current.sendSmsCode("+41791234567"));
    expect(result.current.view).toMatchObject({ step: "code", phoneNumber: "+41791234567" });
    await act(() => result.current.verifySmsCode("+41791234567", "000000"));
    expect(result.current.error).toContain("incorrect");
    await act(() => result.current.verifySmsCode("+41791234567", "123456"));
    expect(result.current.view).toEqual({
      step: "complete",
      invite: { homeserverPubky: HOMESERVER, signupToken: "invite" },
    });
  });

  it("prevents duplicate sends and ignores a late response after going back", async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useHomegateSignup("https://homegate.example"));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.sendSmsCode("+41791234567");
    });
    await act(() => result.current.sendSmsCode("+41791234567"));
    expect(fetch).toHaveBeenCalledOnce();
    act(() => result.current.back());
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await act(async () => {
      finish(new Response(null));
      await pending;
    });
    expect(result.current.view.step).toBe("choose");
    expect(result.current.pending).toBe(false);
  });

  it("polls the same invoice through network failure and payment confirmation", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(invoice))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(
        Response.json({
          id: invoice.id,
          isPaid: true,
          homeserverPubky: HOMESERVER,
          signupCode: "invite",
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const { result, unmount } = renderHook(() => useHomegateSignup("https://homegate.example"));
    await act(() => result.current.createInvoice());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.error).toContain("Could not reach");
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.view).toMatchObject({
      step: "complete",
      invite: { signupToken: "invite" },
    });
    unmount();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("stops polling on back and allows a fresh method choice", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(invoice))
      .mockResolvedValue(Response.json({ id: invoice.id, isPaid: false }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useHomegateSignup("https://homegate.example"));
    await act(() => result.current.createInvoice());
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => result.current.back());
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.view.step).toBe("choose");
  });

  it("expires an unpaid invoice and can recover a late payment without charging again", async () => {
    vi.useFakeTimers();
    const expiring = { ...invoice, expiresAt: Date.now() + 1000 };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(expiring))
      .mockResolvedValueOnce(Response.json({ id: invoice.id, isPaid: false }))
      .mockResolvedValueOnce(Response.json({ id: invoice.id, isPaid: false }))
      .mockResolvedValueOnce(Response.json({ id: invoice.id, isPaid: false }))
      .mockResolvedValueOnce(
        Response.json({
          id: invoice.id,
          isPaid: true,
          homeserverPubky: HOMESERVER,
          signupCode: "invite",
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useHomegateSignup("https://homegate.example"));
    await act(() => result.current.createInvoice());
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.view).toMatchObject({ step: "lightning", expired: true });
    await act(() => result.current.checkPayment(expiring));
    expect(result.current.error).toContain("not been confirmed");
    await act(() => result.current.checkPayment(expiring));
    expect(result.current.view).toMatchObject({ step: "complete" });
    expect(fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });
});
