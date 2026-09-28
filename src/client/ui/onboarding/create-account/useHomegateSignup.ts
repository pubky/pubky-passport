import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type { HomegateSignupErrorCode } from "@/client/logic/homegate/HomegateSignupController";
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

  return {
    view: state.view,
    pending: state.pending,
    error: state.error ? verificationErrorMessage(state.error) : null,
    sentPhoneNumber: state.sentPhoneNumber,
    back: () => controller.back(),
    forget: () => controller.forget(),
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

export function verificationErrorMessage(code: HomegateSignupErrorCode): string {
  switch (code) {
    case "invalid_phone_number":
      return "Enter your phone number with its country code, for example +41791234567.";
    case "invalid_code":
      return "That code is incorrect. Enter the six digits from your SMS.";
    case "blocked":
      return "This verification request was blocked. Go back to choose another method or use an invite code.";
    case "rate_limited":
      return "Too many attempts. Wait a moment before trying again.";
    case "weekly_limit_exceeded":
      return "This phone number has reached its weekly signup limit. Try again next week or choose Lightning.";
    case "annual_limit_exceeded":
      return "This phone number has reached its annual signup limit. Go back to choose Lightning.";
    case "verification_expired":
      return "This verification has expired. Request a new code or invoice.";
    case "payment_not_confirmed":
      return "Payment has not been confirmed yet. If you paid, check again in a moment.";
    default:
      return "Could not reach the verification service. Please try again.";
  }
}
