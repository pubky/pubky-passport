import type { Session } from "@synonymdev/pubky";
import { expect } from "vitest";
import type { FlowHandle } from "../src/flow/FlowPort.js";

export class FakeFlowPort implements FlowHandle {
  readonly violations: string[] = [];
  polls = 0;
  frees = 0;
  reads = 0;
  saves = 0;
  pending = false;
  urlError: unknown;
  saveError: unknown;
  freeError: unknown;
  private resolve?: (session: Session | undefined) => void;
  private reject?: (error: unknown) => void;

  constructor(readonly url = "pubkyauth://" + ["flow", "private", "payload"].join("-")) {}
  get authorizationUrl(): string {
    this.usable();
    if (this.pending) this.violate("getter during poll");
    this.reads++;
    if (this.urlError) throw this.urlError;
    return this.url;
  }
  tryPollOnce(): Promise<Session | undefined> {
    this.usable();
    if (this.pending) this.violate("concurrent poll");
    this.pending = true;
    this.polls++;
    return new Promise<Session | undefined>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    }).finally(() => {
      this.pending = false;
    });
  }
  settle(session?: Session): void {
    if (!this.pending) throw new Error("No poll is pending");
    this.resolve!(session);
  }
  fail(error: unknown): void {
    if (!this.pending) throw new Error("No poll is pending");
    this.reject!(error);
  }
  saveDelegated(): string {
    this.usable();
    if (this.pending) this.violate("save during poll");
    this.saves++;
    if (this.saveError) throw this.saveError;
    return "delegated:" + this.url;
  }
  free(): void {
    if (this.pending) this.violate("free during poll");
    if (this.frees) this.violate("double free");
    this.frees++;
    if (this.freeError) throw this.freeError;
  }
  private usable(): void {
    if (this.frees) this.violate("use after free");
  }
  private violate(message: string): never {
    this.violations.push(message);
    throw new Error(message);
  }
  assertFreed(): void {
    expect(this.violations).toEqual([]);
    expect(this.pending).toBe(false);
    expect(this.frees).toBe(1);
  }
}
