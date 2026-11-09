import { useEffect, useRef, type CSSProperties } from "react";

import { SIGN_IN_BUTTON_HEIGHT } from "@/client/ui/onboarding/signInButtonSize";
import { AppleSignInLogo } from "@/client/ui/shared/brand/appleLogo";
import { ProviderSignInHelp } from "../providerSignInHelp";

/** The system font Apple's guidelines prefer for the title (SF Pro on Apple devices). */
const APPLE_SYSTEM_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Apple's proportions, from Apple's own Sign in with Apple JS button (appleid.auth.js): the title
 * is SF Pro Text Medium at 43% of the button height with -0.022em letter spacing, and the gap
 * between logo and title is 0.7 times the logo's width. The "Small" logo file is 24 by 44 with
 * a 12 wide logo and 6 units of padding on its right, so the title adds the remaining 2.4 units.
 */
const TITLE_SIZE = SIGN_IN_BUTTON_HEIGHT * 0.43;
const LOGO_FILE_WIDTH = (SIGN_IN_BUTTON_HEIGHT * 24) / 44;
const TITLE_GAP = (SIGN_IN_BUTTON_HEIGHT * 2.4) / 44;
/**
 * "Continue with Apple" is about 9.25em wide in Apple's button font. Where the button is too
 * narrow for that title next to the logo within the 8% margins (phones about 340px wide and
 * less), the title gets smaller to fit, as Apple's JS button does; `cqw` is the button's width
 * between those margins.
 */
const TITLE_EMS = 9.4;

const APPLE_BUTTON_STYLE: CSSProperties = {
  containerType: "inline-size",
  fontFamily: APPLE_SYSTEM_FONT,
  fontSize: `${TITLE_SIZE}px`,
  fontWeight: 500,
  height: `${SIGN_IN_BUTTON_HEIGHT}px`,
  letterSpacing: "-0.022em",
};
const APPLE_TITLE_STYLE: CSSProperties = {
  fontSize: `min(${TITLE_SIZE}px, calc((100cqw - ${LOGO_FILE_WIDTH + TITLE_GAP}px) / ${TITLE_EMS}))`,
  marginLeft: `${TITLE_GAP}px`,
};

/**
 * "Continue with Apple" as a custom Sign in with Apple button, per Apple's Human Interface
 * Guidelines: the white style for a dark background (black logo and title on white, no hover
 * tint, still white while Apple's script loads), Apple's left-aligned logo file at the button's
 * full height with no added padding, the title in the system font at 43% of the height, and logo
 * and title centred with at least 8% of the width free on each side. Pill-shaped like Passport's
 * other buttons and the same size as Continue with Google.
 */
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
    <ProviderSignInHelp provider="Apple" purpose={purpose}>
      <button
        ref={button}
        className="inline-flex w-full shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-full bg-white pl-[8%] pr-[52px] py-0 leading-none text-black outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
        disabled={disabled}
        onClick={onContinue}
        style={APPLE_BUTTON_STYLE}
        type="button"
      >
        <AppleSignInLogo />
        <span style={APPLE_TITLE_STYLE}>Continue with Apple</span>
      </button>
    </ProviderSignInHelp>
  );
}

export { ContinueWithApple };
