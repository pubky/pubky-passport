import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
import { OnboardingScreen } from "@/client/ui/shared/onboardingScreen";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { Input } from "@/client/ui/shared/primitives/input";
import { useFocusWhenSettled } from "@/client/ui/shared/useFocusWhenSettled";

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
  onEdit,
  onLightning,
  onUseInvite,
  refusal = null,
  initialPhoneNumber = "",
  sentPhoneNumber,
}: SmsVerificationProps & {
  initialPhoneNumber?: string;
  sentPhoneNumber?: string | undefined;
  /** Called when the number changes, so a failure about the previous one is dropped. */
  onEdit?: () => void;
  /** The number Homegate last refused outright; sending to it again cannot help now. */
  refusal?: { phoneNumber: string; message: string } | null;
  /** Other ways to verify, offered once this number is refused. */
  onLightning?: (() => void) | undefined;
  onUseInvite?: (() => void) | undefined;
}) {
  const [phoneNumber, setPhoneNumber] = useState(initialPhoneNumber);
  // Set when the field is left or sent, so a number is not called wrong while it is typed.
  const [touched, setTouched] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const normalized = phoneNumber.replace(/[\s()-]/g, "");
  const valid = phoneNumberSchema.safeParse(normalized).success;
  const refused = valid && refusal?.phoneNumber === normalized;
  // A failed request is about the service or this number, never about the number's format.
  const serviceError = error ?? (refused ? refusal.message : null);
  const formatError = touched && !valid && !serviceError ? phoneFormatMessage(normalized) : null;
  const message = serviceError ?? formatError;
  const showValid = valid && !serviceError;
  useFocusOnError(input, error);
  return (
    <OnboardingScreen
      accent="phone."
      // Its actions lead on: pinned to a phone's window.
      stickyActions
      actions={
        <PassportNavigation
          back={<BackButton className="max-[30rem]:w-full" onClick={onBack} />}
          confirm={
            // Enabled while the number is wrong, so pressing it says what to fix; a refused number
            // cannot be sent again, and the message beside it says why.
            <Button
              className="w-full"
              disabled={refused}
              form="phone-form"
              loading={pending}
              size="lg"
              type="submit"
            >
              <ArrowRightIcon />
              {pending
                ? "Sending code…"
                : normalized === sentPhoneNumber
                  ? "Continue"
                  : "Send Code"}
            </Button>
          }
        />
      }
      lead="We will send you a verification code."
      title="Enter"
    >
      <form
        className="flex flex-col"
        id="phone-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          if (!valid) {
            setTouched(true);
            input.current?.focus();
            return;
          }
          if (!refused) onSendCode(normalized);
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
            readOnly={pending}
            ref={input}
            containerClassName={`h-14 border-dashed px-4 ${showValid ? "border-brand text-brand" : ""}`}
            className={showValid ? "text-brand" : ""}
            action={showValid ? <CircleCheckIcon className="text-brand" size={20} /> : undefined}
            aria-describedby={
              message ? "phone-help phone-error phone-privacy" : "phone-help phone-privacy"
            }
            aria-invalid={Boolean(message)}
            onBlur={() => {
              if (normalized) setTouched(true);
            }}
            onChange={(event) => {
              setPhoneNumber(event.target.value);
              if (error) onEdit?.();
            }}
          />
          {message ? (
            <FieldMessage id="phone-error" error>
              {message}
            </FieldMessage>
          ) : null}
          {refused && (onLightning || onUseInvite) ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              {onLightning ? (
                <Button onClick={onLightning} variant="link">
                  Pay with Lightning instead
                </Button>
              ) : null}
              {onUseInvite ? (
                <Button onClick={onUseInvite} variant="link">
                  Use an invite code
                </Button>
              ) : null}
            </div>
          ) : null}
          {/* Homegate stores only a peppered one-way hash of the number, to cap sign-ups per number. */}
          <p className="text-sm leading-5 text-muted-foreground" id="phone-privacy">
            Only used to send this code; the sign-up service keeps a one-way hash, never the number.
          </p>
        </OnboardingCard>
      </form>
    </OnboardingScreen>
  );
}

/** Why a typed number cannot be sent yet; the example shows the expected form. */
function phoneFormatMessage(normalized: string): string {
  if (!normalized) return "Enter your phone number with its country code.";
  if (!normalized.startsWith("+"))
    return "Add your country code at the start, for example +41 79 123 45 67.";
  return "Use only digits after the country code, for example +41 79 123 45 67.";
}

export function SmsCodeStep({
  phoneNumber,
  resendAt,
  pending,
  error,
  expired = false,
  onBack,
  onSendCode,
  onVerify,
  onUseInvite,
}: SmsVerificationProps & {
  /** The code can no longer be used (too many wrong attempts, or it timed out); only a new one can. */
  expired?: boolean;
  onUseInvite?: () => void;
  phoneNumber: string;
  resendAt: number;
  onVerify: (phoneNumber: string, code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  // An expired code clears, so the next digits typed are the new code's, and Verify waits for them.
  const [shownExpired, setShownExpired] = useState(expired);
  if (expired !== shownExpired) {
    setShownExpired(expired);
    if (expired) {
      setCode("");
      setCursorPosition(0);
    }
  }
  // Resending and verifying share `pending`; only the button that started the work shows it.
  const [resending, setResending] = useState(false);
  if (resending && !pending) setResending(false);
  const input = useRef<HTMLInputElement>(null);
  useFocusOnError(input, error);
  // A sent code starts the cooldown, which disables the focused Resend; entering it is next.
  useFocusWhenSettled(input, resending);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  // Resend unlocks at once for an expired code, before the clock catches up with its new time.
  const remaining = expired ? 0 : Math.max(0, Math.ceil((resendAt - now) / 1000));
  const valid = smsCodeSchema.safeParse(code).success;
  // Once the code has expired, a new one is the way on, so Resend leads until new digits are in.
  const resendLeads = expired && !valid;
  return (
    <OnboardingScreen
      accent="code."
      // Its actions lead on: pinned to a phone's window.
      stickyActions
      actions={
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <BackButton className="max-[30rem]:w-full" onClick={onBack} />
          {/* Side by side from 360px; narrower (a zoomed popup) they stack instead of wrapping. */}
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 min-[360px]:grid-cols-2 md:ml-auto md:max-w-[480px]">
            <Button
              variant={resendLeads ? "default" : "secondary"}
              className="w-full px-3"
              size="lg"
              disabled={pending || remaining > 0}
              loading={resending}
              onClick={() => {
                setCode("");
                setCursorPosition(0);
                setResending(true);
                onSendCode(phoneNumber);
              }}
            >
              <RotateCcwIcon />
              {resending ? "Sending…" : remaining > 0 ? `Resend (${remaining}s)` : "Resend code"}
            </Button>
            <Button
              variant={resendLeads ? "secondary" : "default"}
              className="w-full px-3"
              disabled={pending || !valid}
              form="sms-code-form"
              loading={pending && !resending}
              size="lg"
              type="submit"
            >
              <CheckIcon />
              {pending && !resending ? "Verifying…" : "Verify Code"}
            </Button>
          </div>
        </div>
      }
      lead={`We sent a 6-digit verification code to ${phoneNumber}.`}
      title="Enter"
    >
      <form
        className="flex flex-col"
        id="sms-code-form"
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
              Enter the code you received on {phoneNumber}.
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
              readOnly={pending}
              ref={input}
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
              // A click would put the caret among the rejected digits, where the full field takes
              // no more; selecting them lets the next digit start the new code.
              onClick={(event) => {
                if (error && code.length === 6) event.currentTarget.select();
              }}
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
                    // Rejected digits turn red rather than keeping the lime of a filled box.
                    error
                      ? "border-destructive text-foreground"
                      : code[index]
                        ? "border-brand text-brand"
                        : "border-input text-muted-foreground",
                    !pending &&
                      index === Math.min(cursorPosition, code.length, 5) && [
                        "group-focus-within/sms-code:border-solid group-focus-within/sms-code:outline-2 group-focus-within/sms-code:outline-offset-2 group-focus-within/sms-code:outline-foreground",
                        error
                          ? "group-focus-within/sms-code:border-destructive"
                          : "group-focus-within/sms-code:border-brand",
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
              className="w-fit cursor-pointer text-sm text-brand hover:underline pointer-coarse:min-h-11"
              type="button"
              onClick={onUseInvite}
            >
              Use an invite code
            </button>
          ) : null}
        </OnboardingCard>
      </form>
    </OnboardingScreen>
  );
}

/** After a failed send or check, puts the person back in the field to correct it. */
function useFocusOnError(input: { current: HTMLInputElement | null }, error: string | null) {
  useLayoutEffect(() => {
    if (!error) return;
    input.current?.focus();
    input.current?.select();
  }, [input, error]);
}
