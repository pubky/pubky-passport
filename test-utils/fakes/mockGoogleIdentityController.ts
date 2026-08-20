import { Result } from "better-result";
import { vi } from "vitest";

import type { GoogleIdentityController } from "../../src/client/logic/google-identity/GoogleIdentityController";

export function mockGoogleIdentityController(
  overrides: Partial<GoogleIdentityController> = {},
): GoogleIdentityController {
  return {
    establishIdentity: overrides.establishIdentity
      ?? vi.fn(async () => Result.err({ code: "authorization_failed" as const })),
    detachIdentity: overrides.detachIdentity
      ?? vi.fn(async () => Result.err({ code: "authorization_failed" as const })),
    dispose: overrides.dispose ?? vi.fn(),
  } as unknown as GoogleIdentityController;
}
