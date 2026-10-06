/** A key's two halves, the first one longer by one character when the length is odd. */
export function balancedHalves(value: string): [string, string] {
  const middle = Math.ceil(value.length / 2);
  return [value.slice(0, middle), value.slice(middle)];
}

/**
 * For the element that holds {@link BalancedKeyText}: nothing breaks a key but its middle `<wbr>`,
 * and `break-word` splits a half only on a screen too narrow even for half a key.
 */
export const BALANCED_KEY_CLASS = "[overflow-wrap:break-word] [word-break:normal]";

/**
 * A long key, such as a 52-character pubky, on one line where it fits and otherwise in two equal
 * halves, so a line never ends with a few characters left over for the next: its only break
 * opportunity is a `<wbr>` at the middle (a key has no spaces). Put it in an element with
 * {@link BALANCED_KEY_CLASS}. The text is the key itself, two text nodes of that element, so
 * selecting and copying it gives the exact key, with no character added.
 */
export function BalancedKeyText({ value }: { value: string }) {
  const [first, second] = balancedHalves(value);
  return (
    <>
      {first}
      <wbr />
      {second}
    </>
  );
}
