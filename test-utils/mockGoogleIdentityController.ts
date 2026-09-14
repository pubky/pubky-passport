import { Result } from "better-result";
import { vi } from "vitest";

import type { GoogleIdentityControllerPort } from "@/client/ui/passportCollaborators";

export type MockGoogleIdentityController = GoogleIdentityControllerPort;

export function mockGoogleIdentityController(
  overrides: Partial<MockGoogleIdentityController> = {},
): MockGoogleIdentityController {
  return {
    clearPinnedGoogleSubject: overrides.clearPinnedGoogleSubject ?? vi.fn(),
    establishIdentity:
      overrides.establishIdentity ??
      vi.fn(async () => Result.err({ code: "authorization_failed" as const })),
    replaceInvalidPassportFile:
      overrides.replaceInvalidPassportFile ??
      vi.fn(async () => Result.err({ code: "authorization_failed" as const })),
    detachIdentity:
      overrides.detachIdentity ??
      vi.fn(async () => Result.err({ code: "authorization_failed" as const })),
    dispose: overrides.dispose ?? vi.fn(),
  };
}
