import Image from "next/image";
import { useEffect, useRef } from "react";

import { SIGN_IN_BUTTON_CLASS_NAME } from "@/client/ui/onboarding/signInButtonSize";
import { Button } from "@/client/ui/shared/primitives/button";
import { ProviderSignInHelp } from "../providerSignInHelp";

function ContinueWithApple({
  autoFocus = false,
  disabled = false,
  onContinue,
  purpose = "setup",
}: {
  autoFocus?: boolean;
  disabled?: boolean;
  onContinue: () => void;
  purpose?: "setup" | "detach";
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Restore focus after an error finishes preparing. Do not interrupt a user in help or Back.
    if (autoFocus && !disabled && document.activeElement === document.body) button.current?.focus();
  }, [autoFocus, disabled]);
  return (
    <ProviderSignInHelp
      disabled={disabled}
      onContinue={onContinue}
      provider="Apple"
      purpose={purpose}
    >
      <Button
        className={SIGN_IN_BUTTON_CLASS_NAME}
        disabled={disabled}
        onClick={onContinue}
        ref={button}
        size="lg"
        variant="secondary"
      >
        <Image
          alt=""
          aria-hidden="true"
          className="size-4 shrink-0"
          height={16}
          priority
          src="/brand/apple-logo.svg"
          width={16}
        />
        <span>Continue with Apple</span>
        <span aria-hidden="true" className="size-4 shrink-0" />
      </Button>
    </ProviderSignInHelp>
  );
}

export { ContinueWithApple };
