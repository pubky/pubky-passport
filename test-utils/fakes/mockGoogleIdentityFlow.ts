import { Result } from "better-result";
import { vi } from "vitest";

import type { GoogleIdentityFlow } from "../../src/client/logic/google-identity/GoogleIdentityFlow";

export function mockGoogleIdentityFlow(
  overrides: Partial<GoogleIdentityFlow> = {},
): GoogleIdentityFlow {
  return {
    establishIdentity: overrides.establishIdentity
      ?? vi.fn(async () => Result.err({ code: "authorization_failed" as const })),
    detachIdentity: overrides.detachIdentity
      ?? vi.fn(async () => Result.err({ code: "authorization_failed" as const })),
    dispose: overrides.dispose ?? vi.fn(),
  } as unknown as GoogleIdentityFlow;
}
