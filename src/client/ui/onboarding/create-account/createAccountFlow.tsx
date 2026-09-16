"use client";

import { Result } from "better-result";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { parseSignupRequest } from "@/client/logic/signup/signupRequest";
import { useGoogleIdentityConfiguration } from "@/client/ui/googleIdentityConfiguration";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { IdentityEstablishmentFlow } from "@/client/ui/onboarding/identityEstablishmentFlow";
import { LightningVerification } from "./lightningVerification";
import { SignupComplete } from "./signupComplete";
import { SignupStep } from "./signupStep";
import { PhoneNumberStep, SmsCodeStep } from "./smsVerification";
import { useHomegateSignup } from "./useHomegateSignup";

export function CreateAccountFlow() {
  const { homegateBaseUrl } = useGoogleIdentityConfiguration();
  const signup = useHomegateSignup(homegateBaseUrl);
  const router = useRouter();
  const captured = useRef<ReturnType<typeof parseSignupRequest> | null>(null);
  const [entry, setEntry] = useState<ReturnType<typeof parseSignupRequest> | null>(null);

  useEffect(() => {
    let active = true;
    if (!captured.current) {
      captured.current = parseSignupRequest(window.location.hash, window.location.search);
      window.history.replaceState(null, "", window.location.pathname);
    }
    const request = captured.current;
    queueMicrotask(() => {
      if (active) setEntry(request);
    });
    return () => {
      active = false;
    };
  }, []);

  if (entry && Result.isError(entry)) {
    return (
      <SignupStep
        title="Unable to"
        accent="continue."
        description="This create-account link is invalid. Return to your app and start again."
      >
        <FieldMessage error>
          Ask the app to open Passport with an invite callback, without an authorization request.
        </FieldMessage>
      </SignupStep>
    );
  }
  const request = entry && Result.isOk(entry) ? entry.value : null;

  const view = signup.view;
  switch (view.step) {
    case "choose":
      return (
        <IdentityEstablishmentFlow
          creatingAccount
          onComplete={() => router.push("/")}
          signupActions={
            <>
              <Button
                size="lg"
                variant="secondary"
                className="w-full"
                disabled={!entry}
                onClick={() => void signup.createInvoice()}
              >
                <LightningIcon /> Continue with Lightning
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="w-full"
                disabled={!entry}
                onClick={signup.chooseSms}
              >
                <SmsIcon /> Continue with SMS
              </Button>
              {request ? (
                <FieldMessage className="break-words">
                  Create your account in Pubky Ring, then return to {request.clientOrigin} to sign
                  in.
                </FieldMessage>
              ) : null}
            </>
          }
        />
      );
    case "phone":
      return (
        <PhoneNumberStep
          pending={signup.pending}
          error={signup.error}
          onBack={signup.back}
          onSendCode={signup.sendSmsCode}
        />
      );
    case "code":
      return (
        <SmsCodeStep
          phoneNumber={view.phoneNumber}
          resendAt={view.resendAt}
          pending={signup.pending}
          error={signup.error}
          onBack={signup.back}
          onSendCode={signup.sendSmsCode}
          onVerify={signup.verifySmsCode}
        />
      );
    case "lightning":
      return (
        <LightningVerification
          invoice={view.invoice}
          expired={view.expired}
          pending={signup.pending}
          error={signup.error}
          onBack={signup.back}
          onCreateInvoice={signup.createInvoice}
          onCheckPayment={signup.checkPayment}
        />
      );
    case "complete":
      return <SignupComplete request={request} invite={view.invite} />;
  }
}

function LightningIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" />
    </svg>
  );
}

function SmsIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
    </svg>
  );
}
