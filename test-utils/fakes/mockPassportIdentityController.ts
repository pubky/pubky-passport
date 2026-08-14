import { Result } from "better-result";
import { vi } from "vitest";

import type {
  GoogleBackedIdentityFlow,
  PassportIdentityController,
} from "../../src/client/logic/identity/passportIdentityController";

export function mockGoogleBackedIdentityFlow(
  overrides: Partial<GoogleBackedIdentityFlow> = {},
): GoogleBackedIdentityFlow {
  return {
    start: overrides.start ?? vi.fn(),
    establishIdentity: overrides.establishIdentity
      ?? vi.fn(async () => Result.err({ code: "authorization_failed" as const })),
    detachIdentity: overrides.detachIdentity
      ?? vi.fn(async () => Result.err({ code: "authorization_failed" as const })),
    dispose: overrides.dispose ?? vi.fn(),
  } as unknown as GoogleBackedIdentityFlow;
}

export function mockPassportIdentityController(
  overrides: Partial<PassportIdentityController> = {},
): PassportIdentityController {
  return {
    listIdentities: vi.fn(() => Result.ok({ activeIdentityId: null, identities: [] })),
    selectIdentity: vi.fn(() => Result.ok()),
    removeIdentity: vi.fn(() => Result.ok()),
    resolveHomeserver: vi.fn(async () => Result.ok(null)),
    createEncryptedBackup: vi.fn(async () => Result.err({ code: "backup_failed" as const })),
    createPubkyRingMigrationUrl: vi.fn(() => Result.err({ code: "no_active_identity" as const })),
    startGoogleIdentityFlow: vi.fn((onState) => {
      onState({ status: "ready" });
      return mockGoogleBackedIdentityFlow();
    }),
    ...overrides,
  } as unknown as PassportIdentityController;
}
