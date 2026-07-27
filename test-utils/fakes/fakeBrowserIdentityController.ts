import { Result } from "better-result";
import { vi } from "vitest";

import type { BrowserIdentityController } from "@/browser/identity/browserIdentityController";

export function fakeBrowserIdentityController(
  overrides: Partial<BrowserIdentityController> = {},
): BrowserIdentityController {
  return {
    list: vi.fn(() => Result.ok({ activeIdentityId: null, identities: [] })),
    select: vi.fn(() => Result.ok()),
    clear: vi.fn(() => Result.ok()),
    subscribe: vi.fn(() => () => {}),
    mountGoogleSignIn: vi.fn(async () => {}),
    unmountGoogleSignIn: vi.fn(),
    retryGoogleSignIn: vi.fn(),
    continueGoogle: vi.fn(async () => ({ status: "credential_failed" as const })),
    dispose: vi.fn(),
    ...overrides,
  };
}
