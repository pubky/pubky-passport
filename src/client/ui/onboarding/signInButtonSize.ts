/**
 * Height of the Continue with Apple and Continue with Google buttons, in CSS pixels. Both
 * buttons are this tall and as wide as their column, so they sit as a matched pair.
 *
 * Each provider's proportions are scaled to this height:
 * - Apple: the title's font size is 43% of the button height (Apple's Human Interface
 *   Guidelines, "Custom buttons with a logo and text"), and Apple's logo file is as tall as the
 *   button.
 * - Google: Google's own large button (Google Identity Services) is 40px tall; Google's branding
 *   guidelines allow scaling it as long as the proportions stay the same.
 */
const SIGN_IN_BUTTON_HEIGHT = 60;

export { SIGN_IN_BUTTON_HEIGHT };
