import { Result } from "better-result";
import { vi } from "vitest";

import type { AppleIdentityViewState } from "@/client/logic/apple-identity/AppleIdentityController";
import type { AppleIdentityControllerPort } from "@/client/ui/passportCollaborators";

export const TEST_APPLE_CONFIGURATION = {
  servicesId: "app.pubky.passport.signin",
  cloudKitContainerId: "iCloud.app.pubky.passport",
  cloudKitApiToken: "0123456789abcdef0123456789abcdef",
  cloudKitEnvironment: "production" as const,
};

/** An Apple controller whose state a test sets directly with `emit`. */
export function fakeAppleIdentityController() {
  let state: AppleIdentityViewState = { status: "idle" };
  const listeners = new Set<(next: AppleIdentityViewState) => void>();
  const ok = () => Promise.resolve(Result.ok(undefined));
  const controller = {
    focusICloud: vi.fn(),
    focusSignIn: vi.fn(),
    cancelSignIn: vi.fn(),
    cancelICloud: vi.fn(),
    connectICloud: vi.fn(ok),
    continueWithApple: vi.fn(ok),
    detachIdentity: vi.fn(ok),
    dispose: vi.fn(() => listeners.clear()),
    getState: () => state,
    replaceInvalidPassportFile: vi.fn(ok),
    replaceUndecryptablePassportFile: vi.fn(ok),
    reset: vi.fn(() => emit({ status: "idle" })),
    subscribe: vi.fn((listener: (next: AppleIdentityViewState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  } satisfies AppleIdentityControllerPort;

  function emit(next: AppleIdentityViewState) {
    state = next;
    for (const listener of listeners) listener(next);
  }

  return { controller, emit };
}
