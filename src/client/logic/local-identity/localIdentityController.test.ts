import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectResultOk } from "../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../libs/logger/logger";
import { PUBKY_SECRET_KEY_FORMAT, type PubkySecretKeyMaterial } from "../pubky/pubkyIdentityKey";
import {
  createLocalIdentityService,
  type LocalIdentityDependencies,
} from "./LocalIdentityController";

const PUBLIC_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";

afterEach(() => vi.restoreAllMocks());

describe("local identity service", () => {
  it("delegates catalog actions to its concrete repository", () => {
    const dependencies = createDependencies();
    const service = createLocalIdentityService(dependencies);

    expect(service.listIdentities()).toEqual(Result.ok({ activePublicKeyZ32: null, identities: [] }));
    expect(service.selectIdentity(PUBLIC_KEY)).toEqual(Result.ok());
    expect(service.removeIdentity(PUBLIC_KEY)).toEqual(Result.ok());
    expect(dependencies.repository.select).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(dependencies.repository.remove).toHaveBeenCalledWith(PUBLIC_KEY);
  });

  it("creates a Ring migration URL for the requested identity and clears secret bytes", () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => index);
    const dependencies = createDependencies({ secretBytes: bytes });
    const service = createLocalIdentityService(dependencies);

    expect(service.createPubkyRingMigrationUrl(PUBLIC_KEY)).toEqual(Result.ok(
      "pubkyring://migrate?index=0&total=1&key=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    ));
    expect(dependencies.repository.read).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(bytes).toEqual(new Uint8Array(32));
  });

  it("rejects weak recovery passwords before reading storage or creating the SDK", async () => {
    const dependencies = createDependencies();
    const service = createLocalIdentityService(dependencies);

    const result = await service.createRecoveryFile(PUBLIC_KEY, "short");
    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_password" });
    expect(dependencies.repository.read).not.toHaveBeenCalled();
    expect(dependencies.createPubky).not.toHaveBeenCalled();
  });

  it("creates a named recovery file and releases sensitive resources", async () => {
    const secretBytes = new Uint8Array(32).fill(7);
    const recoveryBytes = new Uint8Array(64).fill(9);
    const dispose = vi.fn();
    const dependencies = createDependencies({ secretBytes });
    dependencies.createPubky = vi.fn(() => ({
      createRecoveryFile: () => Result.ok(recoveryBytes),
      dispose,
    }));

    const recoveryFile = expectResultOk(await createLocalIdentityService(dependencies)
      .createRecoveryFile(PUBLIC_KEY, "a strong recovery password"));

    expect(recoveryFile).toEqual({ bytes: recoveryBytes, fileName: `pubky-${PUBLIC_KEY}.pkarr` });
    expect(secretBytes).toEqual(new Uint8Array(32));
    expect(dispose).toHaveBeenCalledOnce();
  });

  it.each(["failure", "exception"] as const)(
    "contains an SDK %s and still clears and disposes",
    async (outcome) => {
      const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const secretBytes = new Uint8Array(32).fill(7);
      const dispose = vi.fn();
      const dependencies = createDependencies({ secretBytes });
      dependencies.createPubky = vi.fn(() => ({
        createRecoveryFile: () => {
          if (outcome === "exception") throw new Error("SECRET-RECOVERY-PASSWORD");
          return Result.err({ code: "recovery_file_failed" as const });
        },
        dispose,
      }));

      const result = await createLocalIdentityService(dependencies)
        .createRecoveryFile(PUBLIC_KEY, "a strong recovery password");

      expect(Result.isError(result) && result.error.code).toBe("recovery_file_failed");
      expect(secretBytes).toEqual(new Uint8Array(32));
      expect(dispose).toHaveBeenCalledOnce();
      expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-RECOVERY-PASSWORD");
    },
  );

  it("preserves success when SDK cleanup fails", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const dependencies = createDependencies();
    dependencies.createPubky = vi.fn(() => ({
      createRecoveryFile: () => Result.ok(new Uint8Array(64)),
      dispose: () => { throw new Error("cleanup failed"); },
    }));

    expectResultOk(await createLocalIdentityService(dependencies)
      .createRecoveryFile(PUBLIC_KEY, "a strong recovery password"));
    expect(warning).toHaveBeenCalledWith("identity.recovery_file.cleanup.failed", {
      operation: "pubky_dispose",
    });
  });
});

function createDependencies({ secretBytes = new Uint8Array(32).fill(1) } = {}): LocalIdentityDependencies {
  return {
    createPubky: vi.fn(() => ({
      createRecoveryFile: () => Result.err({ code: "recovery_file_failed" as const }),
      dispose: vi.fn(),
    })),
    repository: {
      list: vi.fn(() => Result.ok({ activePublicKeyZ32: null, identities: [] })),
      read: vi.fn(() => Result.ok({
        identity: { publicIdentity: { publicKeyZ32: PUBLIC_KEY } },
        secretKey: {
          bytes: secretBytes,
          format: PUBKY_SECRET_KEY_FORMAT,
        } satisfies PubkySecretKeyMaterial,
      })),
      remove: vi.fn(() => Result.ok()),
      select: vi.fn(() => Result.ok()),
      subscribe: vi.fn(() => () => undefined),
    },
    resolveHomeserver: vi.fn(async () => Result.ok(null)),
  };
}
