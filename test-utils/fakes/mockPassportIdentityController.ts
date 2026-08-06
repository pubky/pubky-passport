import { Result } from "better-result";
import { vi } from "vitest";

import type { PassportIdentityController } from "../../src/browser/identity/passportIdentity";

export function mockPassportIdentityController(
  overrides: Partial<PassportIdentityController> = {},
): PassportIdentityController {
  return {
    list: vi.fn(() => Result.ok({ activeIdentityId: null, identities: [] })),
    select: vi.fn(() => Result.ok()),
    remove: vi.fn(() => Result.ok()),
    clear: vi.fn(() => Result.ok()),
    subscribe: vi.fn(() => () => {}),
    resolveHomeserver: vi.fn(async () => Result.ok(null)),
    prepareGoogleAuthorization: vi.fn(async () => {}),
    disposeGoogleAuthorization: vi.fn(),
    retryGoogleAuthorization: vi.fn(),
    continueGoogleBackedIdentityAction: vi.fn(async () => ({ status: "google_authorization_failed" as const })),
    dispose: vi.fn(),
    ...overrides,
  };
}
