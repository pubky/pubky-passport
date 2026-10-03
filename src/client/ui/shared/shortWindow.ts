/**
 * Layout tokens for windows no taller than an app's sign-in popup (760px, below 50rem), where a
 * screen tightens so what it lists and its main action stay above the fold. Written out in full so
 * Tailwind finds the classes.
 */

/** A display heading one size smaller. */
export const SHORT_WINDOW_HEADING =
  "[@media(max-height:50rem)]:text-4xl [@media(max-height:50rem)]:md:text-5xl";

/** The space between a screen's parts. */
export const SHORT_WINDOW_GAP = "[@media(max-height:50rem)]:gap-4";
