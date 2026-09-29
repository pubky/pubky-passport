// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HomegateSignupErrorCode,
  HomegateSignupState,
} from "@/client/logic/homegate/HomegateSignupController";
import {
  PassportCollaboratorsProvider,
  type HomegateSignupControllerPort,
} from "@/client/ui/passportCollaborators";
import { useHomegateSignup, verificationErrorMessage } from "./useHomegateSignup";

const INVOICE = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  amountSat: 100,
  bolt11Invoice: "lnbc100n1example",
  expiresAt: 1_900_000_000_000,
};

function fakeController(): HomegateSignupControllerPort & {
  publish: (patch: Partial<HomegateSignupState>) => void;
} {
  let state: HomegateSignupState = {
    view: { step: "choose" },
    pending: false,
    error: null,
    sentPhoneNumber: undefined,
    phoneRefusal: null,
  };
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish: (patch) => {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
    start: vi.fn(),
    dispose: vi.fn(),
    back: vi.fn(),
    forget: vi.fn(),
    releaseInvite: vi.fn(),
    chooseSms: vi.fn(),
    clearError: vi.fn(),
    continueWithPhone: vi.fn(),
    sendSmsCode: vi.fn(async () => undefined),
    verifySmsCode: vi.fn(async () => undefined),
    createInvoice: vi.fn(async () => undefined),
    checkPayment: vi.fn(async () => undefined),
  };
}

function renderSignup(controller = fakeController()) {
  const createHomegateSignupController = vi.fn(() => controller);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PassportCollaboratorsProvider value={{ createHomegateSignupController }}>
      {children}
    </PassportCollaboratorsProvider>
  );
  const hook = renderHook(() => useHomegateSignup("https://homegate.example"), { wrapper });
  return { ...hook, controller, createHomegateSignupController };
}

describe("useHomegateSignup", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates one controller for the configured Homegate and starts it while mounted", () => {
    const { controller, createHomegateSignupController, rerender, unmount } = renderSignup();
    rerender();

    expect(createHomegateSignupController).toHaveBeenCalledOnce();
    expect(createHomegateSignupController).toHaveBeenCalledWith("https://homegate.example");
    expect(controller.start).toHaveBeenCalled();
    unmount();
    expect(controller.dispose).toHaveBeenCalled();
  });

  it("renders controller state and turns error codes into messages", () => {
    const { controller, result } = renderSignup();
    act(() =>
      controller.publish({
        view: { step: "lightning", invoice: INVOICE, expired: true },
        pending: true,
        error: "payment_not_confirmed",
        sentPhoneNumber: "+41791234567",
      }),
    );

    expect(result.current).toMatchObject({
      view: { step: "lightning", invoice: INVOICE, expired: true },
      pending: true,
      error: "Payment has not been confirmed yet. If you paid, check again in a moment.",
      sentPhoneNumber: "+41791234567",
    });
  });

  it("forwards every action to the controller", async () => {
    const { controller, result } = renderSignup();
    result.current.back();
    result.current.forget();
    result.current.releaseInvite();
    result.current.chooseSms();
    result.current.continueWithPhone("+41791234567");
    await result.current.sendSmsCode("+41791234567");
    await result.current.verifySmsCode("+41791234567", "123456");
    await result.current.createInvoice();
    await result.current.checkPayment(INVOICE);

    expect(controller.back).toHaveBeenCalledOnce();
    expect(controller.forget).toHaveBeenCalledOnce();
    expect(controller.releaseInvite).toHaveBeenCalledOnce();
    expect(controller.chooseSms).toHaveBeenCalledOnce();
    expect(controller.continueWithPhone).toHaveBeenCalledWith("+41791234567");
    expect(controller.sendSmsCode).toHaveBeenCalledWith("+41791234567");
    expect(controller.verifySmsCode).toHaveBeenCalledWith("+41791234567", "123456");
    expect(controller.createInvoice).toHaveBeenCalledOnce();
    expect(controller.checkPayment).toHaveBeenCalledWith(INVOICE);
  });

  it.each([
    ["invalid_phone_number", "country code"],
    ["invalid_code", "incorrect"],
    ["blocked", "blocked"],
    ["rate_limited", "Too many attempts"],
    ["weekly_limit_exceeded", "weekly sign-up limit"],
    ["annual_limit_exceeded", "yearly sign-up limit"],
    ["verification_expired", "expired"],
    ["homegate_unavailable", "Could not reach"],
    ["network_failed", "Could not reach"],
    ["malformed_homegate_response", "Could not reach"],
  ] satisfies ReadonlyArray<[HomegateSignupErrorCode, string]>)(
    "explains %s without Homegate's own wording",
    (code, message) => {
      expect(verificationErrorMessage(code)).toContain(message);
    },
  );

  it.each([
    ["blocked", "phone", "Verification by SMS isn’t available for this number."],
    ["blocked", "lightning", "This verification request was blocked."],
    ["verification_expired", "code", "Send a new code to continue."],
    ["verification_expired", "lightning", "This invoice has expired. Create a new one."],
  ] as const)("words %s for the %s step it happened on", (code, step, message) => {
    expect(verificationErrorMessage(code, step)).toContain(message);
  });

  it("names the refused number and exposes the error code and clearing", () => {
    const { controller, result } = renderSignup();
    act(() =>
      controller.publish({
        view: { step: "code", phoneNumber: "+41791234567", resendAt: 0 },
        error: "verification_expired",
        phoneRefusal: { phoneNumber: "+41790000000", code: "weekly_limit_exceeded" },
      }),
    );

    expect(result.current.errorCode).toBe("verification_expired");
    expect(result.current.error).toContain("Send a new code");
    expect(result.current.phoneRefusal).toEqual({
      phoneNumber: "+41790000000",
      message: verificationErrorMessage("weekly_limit_exceeded", "phone"),
    });
    result.current.clearError();
    expect(controller.clearError).toHaveBeenCalledOnce();
  });
});
