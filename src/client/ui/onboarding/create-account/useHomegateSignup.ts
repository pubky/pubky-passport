import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import {
  HomegateVerificationClient,
  type HomegateVerificationFailure,
  type LightningInvoice,
} from "@/client/logic/homegate/HomegateVerificationClient";
import type { HomeserverSignupDetails } from "@/client/logic/homegate/homegateSignup";

type SignupView =
  | { step: "choose" }
  | { step: "phone" }
  | { step: "code"; phoneNumber: string; resendAt: number }
  | { step: "lightning"; invoice: LightningInvoice | null; expired: boolean }
  | { step: "complete"; invite: HomeserverSignupDetails };

export function useHomegateSignup(homegateBaseUrl: string) {
  const [client] = useState(
    () => new HomegateVerificationClient(homegateBaseUrl, globalThis.fetch.bind(globalThis)),
  );
  const [view, setView] = useState<SignupView>({ step: "choose" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      operation.current?.abort();
      operation.current = null;
    },
    [],
  );

  async function run<T>(
    request: (signal: AbortSignal) => Promise<Result<T, HomegateVerificationFailure>>,
    complete: (value: T) => void,
  ) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError(null);
    try {
      const result = await request(controller.signal);
      if (controller.signal.aborted) return;
      if (Result.isError(result)) setError(verificationErrorMessage(result.error.code));
      else complete(result.value);
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setPending(false);
      }
    }
  }

  const invoice = view.step === "lightning" && !view.expired ? view.invoice : null;
  useEffect(() => {
    if (!invoice) return;
    const activeInvoice = invoice;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const result = await client.checkLightningPayment(activeInvoice.id, controller.signal);
      if (controller.signal.aborted) return;
      if (Result.isOk(result) && result.value) {
        setError(null);
        setView({ step: "complete", invite: result.value });
        return;
      }
      if (Result.isError(result)) setError(verificationErrorMessage(result.error.code));
      else setError(null);
      if (Date.now() >= activeInvoice.expiresAt) {
        setView({ step: "lightning", invoice: activeInvoice, expired: true });
        return;
      }
      timer = setTimeout(() => void poll(), 3_000);
    }
    timer = setTimeout(() => void poll(), 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, invoice]);

  function back() {
    operation.current?.abort();
    operation.current = null;
    setPending(false);
    setError(null);
    setView({ step: "choose" });
  }

  function sendSmsCode(phoneNumber: string) {
    return run(
      (signal) => client.sendSmsCode(phoneNumber, signal),
      () => {
        setView({ step: "code", phoneNumber, resendAt: Date.now() + 30_000 });
      },
    );
  }

  function createInvoice() {
    if (operation.current) return;
    setView({ step: "lightning", invoice: null, expired: false });
    return run(
      (signal) => client.createLightningInvoice(signal),
      (invoice) => {
        setView({ step: "lightning", invoice, expired: Date.now() >= invoice.expiresAt });
      },
    );
  }

  return {
    view,
    pending,
    error,
    back,
    sendSmsCode,
    createInvoice,
    chooseSms: () => {
      setError(null);
      setView({ step: "phone" });
    },
    verifySmsCode: (phoneNumber: string, code: string) =>
      run(
        (signal) => client.verifySmsCode(phoneNumber, code, signal),
        (invite) => setView({ step: "complete", invite }),
      ),
    checkPayment: (invoice: LightningInvoice) =>
      run(
        (signal) => client.checkLightningPayment(invoice.id, signal),
        (invite) => {
          if (invite) setView({ step: "complete", invite });
          else
            setError("Payment has not been confirmed yet. If you paid, check again in a moment.");
        },
      ),
  };
}

function verificationErrorMessage(code: HomegateVerificationFailure["code"]): string {
  switch (code) {
    case "invalid_phone_number":
      return "Enter your phone number with its country code, for example +41791234567.";
    case "invalid_code":
      return "That code is incorrect. Enter the six digits from your SMS.";
    case "blocked":
      return "This verification method is unavailable in your region. Go back to choose another method.";
    case "rate_limited":
      return "Too many attempts. Wait a moment before trying again.";
    case "weekly_limit_exceeded":
      return "This phone number has reached its weekly signup limit. Try again next week or choose Lightning.";
    case "annual_limit_exceeded":
      return "This phone number has reached its annual signup limit. Go back to choose Lightning.";
    case "verification_expired":
      return "This verification has expired. Request a new code or invoice.";
    default:
      return "Could not reach the verification service. Please try again.";
  }
}
