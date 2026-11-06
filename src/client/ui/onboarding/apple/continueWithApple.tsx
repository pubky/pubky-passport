import { AppleSignInLogo } from "@/client/ui/shared/brand/appleLogo";
import { Button } from "@/client/ui/shared/primitives/button";

/** The system font Apple's guidelines prefer for the button title (SF Pro on Apple devices). */
const APPLE_SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro", system-ui, sans-serif';

/**
 * "Continue with Apple" as a custom Sign in with Apple button, per Apple's Human Interface
 * Guidelines: the white style for a dark background (black logo and title on white, no hover
 * tint), the title in the system font, and Apple's left-aligned logo file at the button's full
 * height with no added padding. Same size and corner radius as the other sign-in buttons, and
 * at least 8% of the width free right of the title.
 */
function ContinueWithApple({
  disabled = false,
  onContinue,
}: {
  disabled?: boolean;
  onContinue: () => void;
}) {
  return (
    <Button
      className="w-full gap-0 border-0 bg-white px-8 py-0 text-[19px] font-medium leading-none text-black hover:bg-white"
      disabled={disabled}
      onClick={onContinue}
      size="lg"
      style={{ fontFamily: APPLE_SYSTEM_FONT }}
      type="button"
    >
      <AppleSignInLogo />
      Continue with Apple
    </Button>
  );
}

export { ContinueWithApple };
