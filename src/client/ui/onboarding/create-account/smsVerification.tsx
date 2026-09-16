import { useEffect, useState } from "react";

import {
  phoneNumberSchema,
  smsCodeSchema,
} from "@/client/logic/homegate/HomegateVerificationClient";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { Input } from "@/client/ui/shared/primitives/input";
import { Label } from "@/client/ui/shared/primitives/label";
import { SignupStep } from "./signupStep";

type SmsVerificationProps = {
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onSendCode: (phoneNumber: string) => void;
};

export function PhoneNumberStep({ pending, error, onBack, onSendCode }: SmsVerificationProps) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const normalized = phoneNumber.replace(/[\s()-]/g, "");
  return (
    <SignupStep
      title="Verify your"
      accent="phone."
      description="Receive a verification code by SMS to get your signup invite. Your account keys will be created in Pubky Ring."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSendCode(normalized);
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="phone-number">Phone number</Label>
          <Input
            id="phone-number"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            autoFocus
            placeholder="+41 79 123 45 67"
            value={phoneNumber}
            maxLength={32}
            disabled={pending}
            aria-describedby="phone-help"
            onChange={(event) => setPhoneNumber(event.target.value)}
          />
          <FieldMessage id="phone-help">
            Include your country code. Homegate uses Prelude to verify your number.
          </FieldMessage>
        </div>
        {error ? <FieldMessage error>{error}</FieldMessage> : null}
        <PassportNavigation
          back={<BackButton onClick={onBack} />}
          confirm={
            <Button
              className="w-full"
              type="submit"
              size="lg"
              disabled={pending || !phoneNumberSchema.safeParse(normalized).success}
            >
              {pending ? "Sending code…" : "Send verification code"}
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
}: SmsVerificationProps & {
  phoneNumber: string;
  resendAt: number;
  onVerify: (phoneNumber: string, code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
  return (
    <SignupStep
      title="Check your"
      accent="messages."
      description={
        <>
          Enter the six-digit code sent to{" "}
          <span className="font-medium text-foreground">{phoneNumber}</span>. After verification,
          you’ll return to your app to create your account in Pubky Ring.
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onVerify(phoneNumber, code);
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="sms-code">Verification code</Label>
          <Input
            id="sms-code"
            autoComplete="one-time-code"
            inputMode="numeric"
            autoFocus
            maxLength={6}
            pattern="[0-9]{6}"
            placeholder="123456"
            value={code}
            disabled={pending}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          />
        </div>
        {error ? <FieldMessage error>{error}</FieldMessage> : null}
        <Button
          variant="secondary"
          size="lg"
          disabled={pending || remaining > 0}
          onClick={() => onSendCode(phoneNumber)}
        >
          {remaining > 0 ? `Resend code in ${remaining}s` : "Resend code"}
        </Button>
        <PassportNavigation
          back={<BackButton onClick={onBack} />}
          confirm={
            <Button
              className="w-full"
              type="submit"
              size="lg"
              disabled={pending || !smsCodeSchema.safeParse(code).success}
            >
              {pending ? "Verifying…" : "Verify and continue"}
            </Button>
          }
        />
      </form>
    </SignupStep>
  );
}
