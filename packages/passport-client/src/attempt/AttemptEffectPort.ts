import type { AttemptEffect } from "./attemptModel.js";

export type AttemptCommand = Exclude<
  AttemptEffect,
  { type: "Diagnostic" | "EmitSession" | "RevokeSession" | "SetTimer" | "ClearTimer" }
>;

/** Commands execute synchronously; asynchronous work reports its own typed events. */
export interface AttemptEffectPort {
  run(command: AttemptCommand): void;
  dispose(): void;
}
