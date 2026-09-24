import { Result } from "better-result";
import { vi } from "vitest";

import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import type { GoogleIdentityViewState } from "@/client/logic/google-identity/GoogleIdentityController";
import type { GoogleIdentityControllerPort } from "@/client/ui/passportCollaborators";

export type MockGoogleIdentityController = GoogleIdentityControllerPort & {
  /** Publishes an intermediate state while an injected operation is still pending. */
  emitState: (state: GoogleIdentityViewState) => void;
};

type MockOperations = Pick<
  MockGoogleIdentityController,
  | "detachIdentity"
  | "dispose"
  | "establishIdentity"
  | "replaceInvalidPassportFile"
  | "replaceUndecryptablePassportFile"
  | "continueWithoutVisibleBackup"
>;

/**
 * Fakes the controller's state publication around injected operations. Each
 * operation publishes `requesting-authorization` when called and a terminal state
 * derived from its Result, as the real controller does. Unlike the real controller it
 * neither rejects concurrent operations nor suppresses states after `dispose()`.
 */
export function mockGoogleIdentityController(
  overrides: Partial<MockOperations> = {},
): MockGoogleIdentityController {
  let state: GoogleIdentityViewState = { status: "idle" };
  const listeners = new Set<(state: GoogleIdentityViewState) => void>();
  const emitState = (next: GoogleIdentityViewState) => {
    state = next;
    for (const listener of listeners) listener(next);
  };
  const establishIdentity: MockOperations["establishIdentity"] =
    overrides.establishIdentity ??
    vi.fn(async () => Result.err({ code: "authorization_failed" as const }));
  const replaceInvalidPassportFile: MockOperations["replaceInvalidPassportFile"] =
    overrides.replaceInvalidPassportFile ??
    vi.fn(async () => Result.err({ code: "authorization_failed" as const }));
  const replaceUndecryptablePassportFile: MockOperations["replaceUndecryptablePassportFile"] =
    overrides.replaceUndecryptablePassportFile ??
    vi.fn(async () => Result.err({ code: "authorization_failed" as const }));
  const detachIdentity: MockOperations["detachIdentity"] =
    overrides.detachIdentity ??
    vi.fn(async () => Result.err({ code: "authorization_failed" as const }));
  const continueWithoutVisibleBackup: MockOperations["continueWithoutVisibleBackup"] =
    overrides.continueWithoutVisibleBackup ??
    vi.fn(async () => Result.err({ code: "operation_failed" as const }));

  const publishing =
    <Args extends unknown[], Success>(
      operation: (...args: Args) => Promise<Result<Success, GoogleIdentityViewError>>,
      toState: (value: Success) => GoogleIdentityViewState,
    ) =>
    async (...args: Args) => {
      emitState({ status: "requesting-authorization" });
      const result = await operation(...args);
      if (Result.isOk(result)) emitState(toState(result.value));
      else if (result.error.code !== "cancelled")
        emitState({ status: "failed", error: result.error });
      return result;
    };

  return {
    emitState,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset: vi.fn(() => emitState({ status: "idle" })),
    dispose: overrides.dispose ?? vi.fn(),
    establishIdentity: publishing(establishIdentity, (identity) => ({
      status: "established",
      identity,
    })),
    continueWithoutVisibleBackup: publishing(continueWithoutVisibleBackup, (identity) => ({
      status: "established",
      identity,
    })),
    replaceInvalidPassportFile: publishing(replaceInvalidPassportFile, (identity) => ({
      status: "established",
      identity,
    })),
    replaceUndecryptablePassportFile: publishing(replaceUndecryptablePassportFile, (identity) => ({
      status: "established",
      identity,
    })),
    detachIdentity: publishing(detachIdentity, () => ({ status: "detached" })),
  };
}
