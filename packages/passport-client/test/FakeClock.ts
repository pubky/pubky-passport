import { expect } from "vitest";
import type { Clock } from "../src/shared/Clock.js";

export class FakeClock implements Clock {
  private time = 0;
  private next = 0;
  readonly pending = new Map<number, { at: number; callback: () => void }>();
  readonly captured: (() => void)[] = [];
  now = (): number => this.time;
  schedule(callback: () => void, ms: number): () => void {
    const id = ++this.next;
    this.pending.set(id, { at: this.time + ms, callback });
    this.captured.push(callback);
    return () => {
      this.pending.delete(id);
    };
  }
  advance(ms: number): void {
    const end = this.time + ms;
    let iterations = 0;
    for (;;) {
      const next = [...this.pending]
        .filter(([, item]) => item.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      if (++iterations > 10000) throw new Error("Unbounded timer loop");
      const [id, item] = next;
      this.pending.delete(id);
      this.time = item.at;
      item.callback();
    }
    this.time = end;
  }
  assertEmpty(): void {
    expect(this.pending.size).toBe(0);
  }
}
