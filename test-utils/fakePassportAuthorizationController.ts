import { vi } from "vitest";

import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import type { AuthorizationControllerPort } from "@/client/ui/passportCollaborators";

export function fakePassportAuthorizationController(
  state: {
    current?: PassportAuthorizationViewState | undefined;
    listener?: ((state: PassportAuthorizationViewState) => void) | undefined;
  },
  overrides: Partial<AuthorizationControllerPort> = {},
): AuthorizationControllerPort {
  return {
    approve: overrides.approve ?? vi.fn(),
    canWatchExternalApproval: overrides.canWatchExternalApproval ?? (() => false),
    cancel: overrides.cancel ?? vi.fn(),
    dispose: overrides.dispose ?? vi.fn(),
    externalSignerUrl: overrides.externalSignerUrl ?? (() => undefined),
    reportPhase: overrides.reportPhase ?? vi.fn(),
    leaveExternalSigner: overrides.leaveExternalSigner ?? vi.fn(),
    getState:
      overrides.getState ??
      (() => {
        if (!state.current) {
          throw new Error("Authorization state is unavailable.");
        }
        return state.current;
      }),
    subscribe:
      overrides.subscribe ??
      ((listener) => {
        state.listener = listener;
        return () => {
          state.listener = undefined;
        };
      }),
    watchExternalApproval: overrides.watchExternalApproval ?? (() => () => undefined),
    profileNeeded: overrides.profileNeeded ?? (() => undefined),
    profileReady: overrides.profileReady ?? vi.fn(() => false),
  };
}
