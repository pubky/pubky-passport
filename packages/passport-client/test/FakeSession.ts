import type { Session } from "@synonymdev/pubky";
import { expect } from "vitest";

/** Only the SDK lifetime methods used by the ownership boundary are faked. */
export class FakeSession {
  readonly violations: string[] = [];
  signouts = 0;
  frees = 0;
  pending = 0;
  readonly session = {
    signout: () => this.signout(),
    free: () => this.free(),
  } as unknown as Session;

  constructor(
    private readonly outcome: (call: number) => Promise<void> = () => Promise.resolve(),
  ) {}

  private async signout(): Promise<void> {
    if (this.frees) this.violate("use after free");
    if (this.pending) this.violate("concurrent signout");
    this.signouts++;
    this.pending++;
    try {
      await this.outcome(this.signouts);
    } finally {
      this.pending--;
    }
  }
  private free(): void {
    if (this.pending) this.violate("free during signout");
    if (this.frees) this.violate("double free");
    this.frees++;
  }
  private violate(message: string): never {
    this.violations.push(message);
    throw new Error(message);
  }
  assertHealthy(): void {
    expect(this.violations).toEqual([]);
  }
  assertFreed(): void {
    this.assertHealthy();
    expect(this.pending).toBe(0);
    expect(this.frees).toBe(1);
  }
}
