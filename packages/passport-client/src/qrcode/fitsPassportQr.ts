const MAXIMUM_QR_BYTES = 2331;

/** The element checks for an absent or retired RingLink before this byte-size gate. */
export function fitsPassportQr(text: string): boolean {
  return new TextEncoder().encode(text).length <= MAXIMUM_QR_BYTES;
}
