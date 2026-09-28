import { useEffect, useState } from "react";

import {
  phoneNumberSchema,
  smsCodeSchema,
} from "@/client/logic/homegate/HomegateVerificationClient";
import { BackButton } from "@/client/ui/shared/backButton";
import {
  ArrowRightIcon,
  CheckIcon,
  CircleCheckIcon,
  RotateCcwIcon,
} from "@/client/ui/shared/icons";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { OnboardingCard } from "@/client/ui/shared/onboardingCard";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { Input } from "@/client/ui/shared/primitives/input";
import { SignupStep } from "./signupStep";

type SmsVerificationProps = {
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onSendCode: (phoneNumber: string) => void;
};

export function PhoneNumberStep({
  pending,
  error,
  onBack,
  onSendCode,
  initialPhoneNumber = "",
  sentPhoneNumber,
}: SmsVerificationProps & { initialPhoneNumber?: string; sentPhoneNumber?: string | undefined }) {
  const [phoneNumber, setPhoneNumber] = useState(initialPhoneNumber);
  const normalized = phoneNumber.replace(/[\s()-]/g, "");
  const valid = phoneNumberSchema.safeParse(normalized).success;
  return (
    <SignupStep title="Enter" accent="Phone." description="We will send you a verification code.">
      <form
        className="flex flex-1 flex-col gap-6 md:gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !pending) onSendCode(normalized);
        }}
      >
        <OnboardingCard illustration="/illustrations/phone-number.png">
          <div className="flex flex-col gap-3">
            <label className="text-xl font-bold leading-7" htmlFor="phone-number">
              Phone number
            </label>
            <p className="text-base leading-6 text-secondary-foreground" id="phone-help">
              Enter your phone number, including country code (e.g. +1 for US).
            </p>
          </div>
          <Input
            id="phone-number"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            autoFocus
            placeholder="+1 000 000 0000"
            value={phoneNumber}
            maxLength={32}
            disabled={pending}
            containerClassName={`h-14 border-dashed px-4 ${valid ? "border-brand text-brand focus-within:border-brand focus-within:ring-brand/20" : ""}`}
            className={valid ? "text-brand" : ""}
            action={valid ? <CircleCheckIcon className="text-brand" size={20} /> : undefined}
            aria-describedby={error ? "phone-help phone-error" : "phone-help"}
            aria-invalid={Boolean(error)}
            onChange={(event) => setPhoneNumber(event.target.value)}
          />
          {error ? (
            <FieldMessage id="phone-error" error>
              {error}
            </FieldMessage>
          ) : null}
        </OnboardingCard>
        <PassportNavigation
          className="mt-auto md:mt-0"
          back={<BackButton onClick={onBack} />}
          confirm={
            <Button className="w-full" type="submit" size="lg" disabled={pending || !valid}>
              <ArrowRightIcon />
              {pending
                ? "Sending code…"
                : normalized === sentPhoneNumber
                  ? "Continue"
                  : "Send Code"}
            </Button>
          }
        />
      </form>
    </SignupStep>
  );
}

export function SmsCodeStep({
  phoneNumber,
  resendAt,
  pending,
  error,
  onBack,
  onSendCode,
  onVerify,
  onUseInvite,
}: SmsVerificationProps & {
  onUseInvite?: () => void;
  phoneNumber: string;
  resendAt: number;
  onVerify: (phoneNumber: string, code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const valid = smsCodeSchema.safeParse(code).success;
  return (
    <SignupStep
      title="Enter"
      accent="Code."
      description={`We sent a 6-digit verification code to ${phoneNumber}.`}
    >
      <form
        className="flex flex-1 flex-col gap-6 md:gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !pending) onVerify(phoneNumber, code);
        }}
      >
        <OnboardingCard illustration="/illustrations/sms-verification.png">
          <div className="flex flex-col gap-3">
            <label className="text-xl font-bold leading-7" htmlFor="sms-code">
              Verification code
            </label>
            <p className="text-base leading-6 text-secondary-foreground" id="sms-help">
              Enter the verification code sent to {phoneNumber}.
            </p>
          </div>
          <div className="group/sms-code relative">
            <input
              id="sms-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              autoFocus
              className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0 outline-none disabled:cursor-not-allowed"
              maxLength={6}
              pattern="[0-9]{6}"
              value={code}
              disabled={pending}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "sms-help sms-error" : "sms-help"}
              onChange={(event) => {
                const { value, selectionStart } = event.currentTarget;
                setCode(value.replace(/\D/g, ""));
                setCursorPosition(
                  value.slice(0, selectionStart ?? value.length).replace(/\D/g, "").length,
                );
              }}
              onSelect={(event) => setCursorPosition(event.currentTarget.selectionStart ?? 0)}
            />
            <div
              aria-hidden="true"
              className={`grid grid-cols-6 gap-2 ${pending ? "opacity-50" : ""}`}
            >
              {Array.from({ length: 6 }, (_, index) => (
                <span
                  key={index}
                  className={cn(
                    "flex h-14 min-w-0 items-center justify-center rounded-lg border border-dashed bg-black/10 text-lg font-medium",
                    code[index] ? "border-brand text-brand" : "border-input text-muted-foreground",
                    error && "border-destructive",
                    !pending &&
                      index === Math.min(cursorPosition, code.length, 5) && [
                        "group-focus-within/sms-code:border-solid group-focus-within/sms-code:ring-2",
                        error
                          ? "group-focus-within/sms-code:border-destructive group-focus-within/sms-code:ring-destructive/20"
                          : "group-focus-within/sms-code:border-brand group-focus-within/sms-code:ring-brand/20",
                      ],
                  )}
                >
                  {code[index] ?? ""}
                </span>
              ))}
            </div>
          </div>
          {error ? (
            <FieldMessage id="sms-error" error>
              {error}
            </FieldMessage>
          ) : null}
          {error && onUseInvite ? (
            <button
              className="w-fit cursor-pointer text-sm text-brand hover:underline"
              type="button"
              onClick={onUseInvite}
            >
              Use an invite code
            </button>
          ) : null}
        </OnboardingCard>
        <div className="mt-auto flex flex-col gap-4 md:mt-0 md:flex-row md:items-center">
          <BackButton onClick={onBack} />
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 md:grid-cols-[minmax(0,1fr)_228px]">
            <Button
              variant="secondary"
              className="w-full px-3"
              size="lg"
              disabled={pending || remaining > 0}
              onClick={() => {
                setCode("");
                setCursorPosition(0);
                onSendCode(phoneNumber);
              }}
            >
              <RotateCcwIcon />
              {remaining > 0 ? `Resend (${remaining}s)` : "Resend Code"}
            </Button>
            <Button className="w-full px-3" type="submit" size="lg" disabled={pending || !valid}>
              <CheckIcon />
              {pending ? "Verifying…" : "Verify Code"}
            </Button>
          </div>
        </div>
      </form>
    </SignupStep>
  );
}
