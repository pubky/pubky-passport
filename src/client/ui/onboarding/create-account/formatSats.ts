/**
 * A satoshi amount for display, grouped the same way on every screen whatever the browser's
 * locale, so the price in the method list matches the invoice ("1,000", never "1.000").
 */
export function formatSats(amountSat: number): string {
  return amountSat.toLocaleString("en-US");
}
