export interface RingLink {
  reveal(): string | undefined;
  toString(): "[RingLink]";
  toJSON(): "[RingLink]";
}

/** A live accessor keeps snapshots redacted and lets a retired flow invalidate them. */
export function createRingLink(reveal: RingLink["reveal"]): RingLink {
  return Object.freeze({
    reveal,
    toString: () => "[RingLink]" as const,
    toJSON: () => "[RingLink]" as const,
  });
}
