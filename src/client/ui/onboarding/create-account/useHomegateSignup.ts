import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type {
  HomegateSignupErrorCode,
  HomegateSignupView,
} from "@/client/logic/homegate/HomegateSignupController";
import type { LightningInvoice } from "@/client/logic/homegate/HomegateVerificationClient";
import { usePassportCollaborators } from "@/client/ui/passportCollaborators";

/** Bridges one account creation's Homegate signup controller to React. */
export function useHomegateSignup(homegateBaseUrl: string) {
  const { createHomegateSignupController } = usePassportCollaborators();
  // The Homegate URL is fixed for a mounted flow; configuration changes remount the app.
  const [controller] = useState(() => createHomegateSignupController(homegateBaseUrl));
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  );
  const getState = useCallback(() => controller.getState(), [controller]);
  const state = useSyncExternalStore(subscribe, getState, getState);

  useEffect(() => {
    controller.start();
    return () => controller.dispose();
  }, [controller]);

  const step = state.view.step;
  return {
    view: state.view,
    pending: state.pending,
    error: state.error ? verificationErrorMessage(state.error, step) : null,
    errorCode: state.error,
    sentPhoneNumber: state.sentPhoneNumber,
    /** The number Homegate last refused outright, with what to tell the person about it. */
    phoneRefusal: state.phoneRefusal
      ? {
          phoneNumber: state.phoneRefusal.phoneNumber,
          message: verificationErrorMessage(state.phoneRefusal.code, "phone"),
        }
      : null,
    /** The homeserver refused the invite the last verification issued; see `forget`. */
    verificationRefused: state.verificationRefused,
    clearError: () => controller.clearError(),
    back: () => controller.back(),
    forget: (options?: { refused?: boolean }) => controller.forget(options),
    dismissRefusal: () => controller.dismissRefusal(),
    releaseInvite: () => controller.releaseInvite(),
    chooseSms: () => controller.chooseSms(),
    continueWithPhone: (phoneNumber: string) => controller.continueWithPhone(phoneNumber),
    sendSmsCode: (phoneNumber: string) => controller.sendSmsCode(phoneNumber),
    verifySmsCode: (phoneNumber: string, code: string) =>
      controller.verifySmsCode(phoneNumber, code),
    createInvoice: () => controller.createInvoice(),
    checkPayment: (invoice: LightningInvoice) => controller.checkPayment(invoice),
  };
}

/**
 * What to tell the person about a failed verification step. `step` is the screen it happened on:
 * SMS refusals point to the other methods offered there, and an expired SMS code or Lightning
 * invoice each say how to get a new one.
 */
export function verificationErrorMessage(
  code: HomegateSignupErrorCode,
  step: HomegateSignupView["step"] = "choose",
): string {
  const sms = step === "phone" || step === "code";
  switch (code) {
    case "invalid_phone_number":
      return "Enter your phone number with its country code, for example +41 79 123 45 67.";
    case "invalid_code":
      return "That code is incorrect. Enter the six digits from your SMS.";
    case "blocked":
      return sms
        ? "Verification by SMS isn’t available for this number. Choose another method below."
        : "This verification request was blocked. Go back to choose another method or use an invite code.";
    case "rate_limited":
      return "Too many attempts. Wait a moment before trying again.";
    case "weekly_limit_exceeded":
      return "This number has reached its weekly sign-up limit. Try again next week or choose another method below.";
    case "annual_limit_exceeded":
      return "This number has reached its yearly sign-up limit. Choose another method below.";
    case "verification_expired":
      return step === "code"
        ? "This code has expired or had too many wrong attempts. Send a new code to continue."
        : step === "lightning"
          ? "This invoice has expired. Create a new one."
          : "This verification has expired. Start again.";
    case "payment_not_confirmed":
      return "Payment has not been confirmed yet. If you paid, check again in a moment.";
    case "invalid_homegate_homeserver":
      // Passport never signs up anywhere but the homeserver a code was issued for.
      return step === "lightning"
        ? "Your payment went through, but the verification service didn’t say which homeserver your account belongs on. Passport keeps checking, so keep this page open or come back later."
        : "The verification service didn’t say which homeserver your account belongs on, so no account was created. Try again later or choose another method below.";
    default:
      return "Could not reach the verification service. Please try again.";
  }
}
