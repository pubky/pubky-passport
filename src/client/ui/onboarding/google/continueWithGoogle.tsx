import { SIGN_IN_BUTTON_CLASS_NAME } from "@/client/ui/onboarding/signInButtonSize";
import { GoogleButtonLogo } from "@/client/ui/shared/brand/googleButtonLogo";
import { Button } from "@/client/ui/shared/primitives/button";
import { ProviderSignInHelp } from "../providerSignInHelp";

function ContinueWithGoogle({
  disabled = false,
  onContinue,
}: {
  disabled?: boolean;
  onContinue: () => void;
}) {
  return (
    <ProviderSignInHelp disabled={disabled} onContinue={onContinue} provider="Google">
      <Button
        className={SIGN_IN_BUTTON_CLASS_NAME}
        disabled={disabled}
        onClick={onContinue}
        size="lg"
        variant="secondary"
      >
        <GoogleButtonLogo className="size-4 shrink-0" />
        <span>Continue with Google</span>
        <span aria-hidden="true" className="size-4 shrink-0" />
      </Button>
    </ProviderSignInHelp>
  );
}

export { ContinueWithGoogle };
