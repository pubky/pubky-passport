import type { CSSProperties } from "react";

import { SIGN_IN_BUTTON_HEIGHT } from "@/client/ui/onboarding/signInButtonSize";
import { GoogleButtonLogo } from "@/client/ui/shared/brand/googleButtonLogo";
import { ProviderSignInHelp } from "../providerSignInHelp";

/** Google Identity Services' large button is 40px tall; this pair is scaled to match Apple's. */
const SCALE = SIGN_IN_BUTTON_HEIGHT / 40;

/**
 * Google's large button, scaled: Google Sans Medium 14px with 0.25px letter spacing, 12px
 * padding on each side, a 20px "G" and 10px between the "G" and the title.
 */
const GOOGLE_BUTTON_STYLE: CSSProperties = {
  containerType: "inline-size",
  fontFamily: '"Google Sans", Roboto, Arial, sans-serif',
  fontSize: `${14 * SCALE}px`,
  fontWeight: 500,
  height: `${SIGN_IN_BUTTON_HEIGHT}px`,
  letterSpacing: `${0.25 * SCALE}px`,
  paddingLeft: `${12 * SCALE}px`,
  paddingRight: "52px",
};
const GOOGLE_LOGO_STYLE: CSSProperties = {
  height: `${20 * SCALE}px`,
  marginRight: `${10 * SCALE}px`,
  width: `${20 * SCALE}px`,
};

/**
 * "Continue with Google" in Google's Light theme from the Sign in with Google branding guidelines
 * (fill #FFFFFF, 1px #747775 stroke, #1F1F1F text, Google Sans Medium, the standard-color "G"),
 * pill-shaped and laid out like Google's own button with the "G" centred next to the title.
 * Hover and press use the Light theme's subtle tinted feedback.
 */
function ContinueWithGoogle({ onContinue }: { onContinue: () => void }) {
  return (
    <ProviderSignInHelp provider="Google">
      <button
        className="inline-flex w-full shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-full border border-[#747775] bg-white py-0 leading-none text-[#1F1F1F] outline-none transition-colors hover:border-[#D2E3FC] hover:bg-[#F8FAFD] focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-[#EFF3F9]"
        onClick={onContinue}
        style={GOOGLE_BUTTON_STYLE}
        type="button"
      >
        <GoogleButtonLogo className="shrink-0" style={GOOGLE_LOGO_STYLE} />
        <span style={{ fontSize: `min(${14 * SCALE}px, calc((100cqw - ${30 * SCALE}px) / 10.4))` }}>
          Continue with Google
        </span>
      </button>
    </ProviderSignInHelp>
  );
}

export { ContinueWithGoogle };
