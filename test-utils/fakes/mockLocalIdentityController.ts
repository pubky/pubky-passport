import { Result } from "better-result";
import { vi } from "vitest";

import type { LocalIdentityController } from "../../src/client/logic/local-identity/LocalIdentityController";

export function mockLocalIdentityController(
  overrides: Partial<LocalIdentityController> = {},
): LocalIdentityController {
  return {
    listIdentities: vi.fn(() => Result.ok({ activePublicKeyZ32: null, identities: [] })),
    selectIdentity: vi.fn(() => Result.ok()),
    removeIdentity: vi.fn(() => Result.ok()),
    resolveHomeserver: vi.fn(async () => Result.ok(null)),
    createEncryptedBackup: vi.fn(async () => Result.err({ code: "backup_failed" as const })),
    createPubkyRingMigrationUrl: vi.fn(() => Result.err({ code: "no_active_identity" as const })),
    ...overrides,
  } as unknown as LocalIdentityController;
}
