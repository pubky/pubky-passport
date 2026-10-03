/**
 * The most combining marks shown on one character. Real text rarely stacks more than two or three
 * (Vietnamese tones, Hebrew points with a cantillation mark); a long stack only draws over the
 * lines around it, such as the website line or the broad-access warning.
 */
export const MAXIMUM_SHOWN_COMBINING_MARKS = 3;

const EXCESS_COMBINING_MARKS = new RegExp(
  `([\\p{Mn}\\p{Me}]{${MAXIMUM_SHOWN_COMBINING_MARKS}})[\\p{Mn}\\p{Me}]+`,
  "gu",
);

/**
 * App-supplied text (an `x-source` label, a capability path) as it may be shown: every run of
 * nonspacing or enclosing marks is cut to {@link MAXIMUM_SHOWN_COMBINING_MARKS}. For display only;
 * the request that is signed keeps every character it had.
 */
export function limitCombiningMarks(text: string): string {
  return text.replace(EXCESS_COMBINING_MARKS, "$1");
}
