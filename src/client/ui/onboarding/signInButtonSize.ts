/** Figma's 60px content height; the reference PNG includes an extra 4px of frame/shadow. */
const SIGN_IN_BUTTON_HEIGHT = 60;

/**
 * The owner's compact Figma typography, shared by every sign-in callsite. The 14px Inter Tight
 * title deliberately differs from Apple's 43%-of-height guidance and Google's scaled layout.
 */
const SIGN_IN_BUTTON_CLASS_NAME =
  "col-start-1 row-start-1 h-15 w-full gap-2 rounded-full border-0 bg-white px-8 py-5 text-sm font-bold leading-5 text-[#1d1d20] hover:bg-white disabled:opacity-100";

export { SIGN_IN_BUTTON_CLASS_NAME, SIGN_IN_BUTTON_HEIGHT };
