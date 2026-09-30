import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recoveryFileBytes } from "@test-utils/recoveryFiles";
import { expectResultOk } from "@test-utils/resultAssertions";
import { LOGGER } from "@/libs/logger/logger";
import {
  PUBKY_SECRET_KEY_FORMAT,
  type PubkySecretKeyMaterial,
} from "@/client/logic/pubky/pubkyIdentityKey";

const MOCKS = vi.hoisted(() => ({
  createRecoveryFile: vi.fn(),
  dispose: vi.fn(),
  publishHomeserver: vi.fn(),
  resolveHomeserver: vi.fn(),
  disposeIdentityKey: vi.fn(),
  resolvePubkyHomeserver: vi.fn(),
  restoreIdentityKey: vi.fn(),
  restoreRecoveryFile: vi.fn(),
}));

vi.mock("@/client/logic/pubky/PubkySdkAdapter", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/client/logic/pubky/PubkySdkAdapter")>();
  return {
    ...original,
    PubkySdkAdapter: class {
      static createPubkyRingMigration(secretKey: PubkySecretKeyMaterial, publicKeyZ32: string) {
        return original.PubkySdkAdapter.createPubkyRingMigration(secretKey, publicKeyZ32);
      }
      createRecoveryFile = MOCKS.createRecoveryFile;
      dispose = MOCKS.dispose;
      disposeIdentityKey = MOCKS.disposeIdentityKey;
      publishHomeserver = MOCKS.publishHomeserver;
      resolveHomeserver = MOCKS.resolveHomeserver;
      restoreIdentityKey = MOCKS.restoreIdentityKey;
      restoreRecoveryFile = MOCKS.restoreRecoveryFile;
    },
    resolvePubkyHomeserver: MOCKS.resolvePubkyHomeserver,
  };
});

import { LocalIdentityController } from "./LocalIdentityController";

const PUBLIC_KEY = "yqooxx9u3aemh8mo5wcqq16yufu6jitouq1o4za751dger1igghy";
const HOMESERVER = "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";
const OTHER_HOMESERVER = "8um71us3fyw6h8wbcxb5ar3rwusy1a6u49956ikzojg3gcwd1dty";

beforeEach(() => {
  MOCKS.createRecoveryFile.mockReset();
  MOCKS.dispose.mockReset();
  MOCKS.publishHomeserver.mockReset();
  MOCKS.resolveHomeserver.mockReset();
  MOCKS.resolvePubkyHomeserver.mockReset();
  MOCKS.restoreIdentityKey.mockReset();
  MOCKS.disposeIdentityKey.mockReset();
  MOCKS.restoreRecoveryFile.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const NOW = new Date(Date.UTC(2026, 8, 29, 12));

describe("LocalIdentityController", () => {
  it("delegates catalog actions to the injected repository", () => {
    const repository = {
      list: vi.fn(() => Result.ok({ activePublicKeyZ32: null, identities: [] })),
      select: vi.fn(() => Result.ok()),
      remove: vi.fn(() => Result.ok()),
      subscribe: vi.fn(() => () => undefined),
      read: vi.fn(),
      recordBackup: vi.fn(() => Result.ok()),
    };
    const drafts = { remove: vi.fn(() => Result.ok()) };
    const controller = new LocalIdentityController(repository, drafts);

    expect(controller.listIdentities()).toEqual(
      Result.ok({ activePublicKeyZ32: null, identities: [] }),
    );
    expect(controller.selectIdentity(PUBLIC_KEY)).toEqual(Result.ok());
    expect(controller.removeIdentity(PUBLIC_KEY)).toEqual(Result.ok());
    // The key is not saved, so no draft of it is touched: it may be a setup still under way.
    expect(drafts.remove).not.toHaveBeenCalled();
    expect(repository.list).toHaveBeenCalledTimes(2);
    expect(repository.select).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(repository.remove).toHaveBeenCalledWith(PUBLIC_KEY);
  });

  it("creates an owned Ring migration and clears the repository secret bytes", async () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => index);
    const repository = storedIdentityRepository(bytes);
    const controller = new LocalIdentityController(repository);

    const migration = expectResultOk(await controller.createPubkyRingMigration(PUBLIC_KEY));
    expect(migration.url).toBe(
      "pubkyring://000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    );
    expect(repository.read).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(bytes).toEqual(new Uint8Array(32));

    migration.dispose();
    expect(migration.url).toBeNull();
  });

  it("rejects weak recovery passwords before reading storage or creating the SDK", async () => {
    const repository = storedIdentityRepository(new Uint8Array(32));
    const controller = new LocalIdentityController(repository);

    const result = await controller.createRecoveryFile(PUBLIC_KEY, "short");
    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_password" });
    expect(repository.read).not.toHaveBeenCalled();
    expect(MOCKS.createRecoveryFile).not.toHaveBeenCalled();
  });

  it("creates a named recovery file, records it and releases sensitive resources", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const secretBytes = new Uint8Array(32).fill(7);
    const recoveryBytes = new Uint8Array(64).fill(9);
    const password = "ten-character-pw";
    const repository = storedIdentityRepository(secretBytes);
    MOCKS.createRecoveryFile.mockReturnValue(Result.ok(recoveryBytes));

    const recoveryFile = expectResultOk(
      await new LocalIdentityController(repository).createRecoveryFile(PUBLIC_KEY, password),
    );
    expect(repository.recordBackup).toHaveBeenCalledWith(PUBLIC_KEY, "created", NOW);

    expect(recoveryFile).toEqual({ bytes: recoveryBytes, fileName: `pubky-${PUBLIC_KEY}.pkarr` });
    expect(MOCKS.createRecoveryFile).toHaveBeenCalledWith(
      expect.objectContaining({ bytes: secretBytes }),
      PUBLIC_KEY,
      password,
    );
    expect(secretBytes).toEqual(new Uint8Array(32));
    expect(MOCKS.dispose).toHaveBeenCalledOnce();
  });

  it.each(["failure", "exception"] as const)(
    "contains an SDK %s and still clears and disposes",
    async (outcome) => {
      const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const secretBytes = new Uint8Array(32).fill(7);
      MOCKS.createRecoveryFile.mockImplementation(() => {
        if (outcome === "exception") throw new Error("SECRET-RECOVERY-PASSWORD");
        return Result.err({ code: "recovery_file_failed" as const });
      });

      const repository = storedIdentityRepository(secretBytes);
      const result = await new LocalIdentityController(repository).createRecoveryFile(
        PUBLIC_KEY,
        "a strong recovery password",
      );

      expect(Result.isError(result) && result.error.code).toBe("recovery_file_failed");
      expect(repository.recordBackup).not.toHaveBeenCalled();
      expect(secretBytes).toEqual(new Uint8Array(32));
      expect(MOCKS.dispose).toHaveBeenCalledOnce();
      expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-RECOVERY-PASSWORD");
    },
  );

  it("preserves success when SDK cleanup fails", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.createRecoveryFile.mockReturnValue(Result.ok(new Uint8Array(64)));
    MOCKS.dispose.mockImplementation(() => {
      throw new Error("SECRET-RECOVERY-CLEANUP-CANARY");
    });

    expectResultOk(
      await new LocalIdentityController(
        storedIdentityRepository(new Uint8Array(32).fill(1)),
      ).createRecoveryFile(PUBLIC_KEY, "a strong recovery password"),
    );
    expect(warning).toHaveBeenCalledWith("identity.recovery_file.cleanup.failed", {
      operation: "pubky_dispose",
      diagnosticId: expect.any(String),
      errorName: "Error",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-RECOVERY-CLEANUP-CANARY");
  });

  it("keeps a created recovery file when its status cannot be recorded", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const repository = {
      ...storedIdentityRepository(new Uint8Array(32).fill(1)),
      recordBackup: vi.fn(() => Result.err({ code: "storage_unavailable" as const })),
    };
    MOCKS.createRecoveryFile.mockReturnValue(Result.ok(new Uint8Array(64)));

    expectResultOk(
      await new LocalIdentityController(repository).createRecoveryFile(
        PUBLIC_KEY,
        "a strong recovery password",
      ),
    );
    expect(warning).toHaveBeenCalledWith("identity.controller.failed", {
      operation: "record_backup",
      code: "storage_unavailable",
    });
  });

  it("records a recovery file that opens as this identity and clears its bytes", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const keyHandle = {};
    const bytes = new Uint8Array(64).fill(3);
    const repository = storedIdentityRepository(new Uint8Array(32));
    MOCKS.restoreRecoveryFile.mockReturnValue(
      Result.ok({ keyHandle, publicIdentity: { publicKeyZ32: PUBLIC_KEY } }),
    );

    expectResultOk(
      await new LocalIdentityController(repository).verifyRecoveryFile(PUBLIC_KEY, bytes, "pw"),
    );

    expect(MOCKS.restoreRecoveryFile).toHaveBeenCalledWith(bytes, "pw");
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(keyHandle);
    expect(repository.recordBackup).toHaveBeenCalledWith(PUBLIC_KEY, "verified", NOW);
    expect(bytes).toEqual(new Uint8Array(64));
    expect(repository.read).not.toHaveBeenCalled();
  });

  it.each([
    ["belongs to another pubky", "backup_mismatch", OTHER_HOMESERVER],
    ["does not open", "backup_decryption_failed", undefined],
  ] as const)("records nothing when the file %s", async (_, code, restoredKey) => {
    const repository = storedIdentityRepository(new Uint8Array(32));
    MOCKS.restoreRecoveryFile.mockReturnValue(
      restoredKey
        ? Result.ok({ keyHandle: {}, publicIdentity: { publicKeyZ32: restoredKey } })
        : Result.err({ code: "invalid_recovery_file" }),
    );

    const result = await new LocalIdentityController(repository).verifyRecoveryFile(
      PUBLIC_KEY,
      recoveryFileBytes(),
      "pw",
    );

    expect(Result.isError(result) && result.error.code).toBe(code);
    expect(repository.recordBackup).not.toHaveBeenCalled();
  });

  it("publishes the given homeserver only when no record exists, then verifies it", async () => {
    const secretBytes = new Uint8Array(32).fill(7);
    const keyHandle = {};
    const repository = storedIdentityRepository(secretBytes);
    MOCKS.resolveHomeserver.mockResolvedValue(Result.ok(null));
    MOCKS.restoreIdentityKey.mockReturnValue(
      Result.ok({ keyHandle, publicIdentity: { publicKeyZ32: PUBLIC_KEY } }),
    );
    MOCKS.publishHomeserver.mockResolvedValue(Result.ok());
    MOCKS.resolvePubkyHomeserver.mockResolvedValue(Result.ok(HOMESERVER));

    expect(
      expectResultOk(
        await new LocalIdentityController(repository).republishHomeserver(PUBLIC_KEY, HOMESERVER),
      ),
    ).toBe(HOMESERVER);

    expect(MOCKS.resolveHomeserver).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(MOCKS.restoreIdentityKey).toHaveBeenCalledWith(
      expect.objectContaining({ bytes: secretBytes }),
    );
    expect(MOCKS.publishHomeserver).toHaveBeenCalledWith(keyHandle, HOMESERVER);
    expect(MOCKS.resolvePubkyHomeserver).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(secretBytes).toEqual(new Uint8Array(32));
    expect(MOCKS.dispose).toHaveBeenCalledOnce();
  });

  it("refuses any host but the homeserver the identity was signed up on", async () => {
    const secretBytes = new Uint8Array(32).fill(7);

    const result = await new LocalIdentityController(
      storedIdentityRepository(secretBytes, OTHER_HOMESERVER),
    ).republishHomeserver(PUBLIC_KEY, HOMESERVER);

    expect(Result.isError(result) && result.error).toEqual({ code: "homeserver_mismatch" });
    expect(MOCKS.resolveHomeserver).not.toHaveBeenCalled();
    expect(MOCKS.publishHomeserver).not.toHaveBeenCalled();
    expect(secretBytes).toEqual(new Uint8Array(32));
  });

  it("repairs a missing record with the homeserver the identity was signed up on", async () => {
    const keyHandle = {};
    MOCKS.resolveHomeserver.mockResolvedValue(Result.ok(null));
    MOCKS.restoreIdentityKey.mockReturnValue(
      Result.ok({ keyHandle, publicIdentity: { publicKeyZ32: PUBLIC_KEY } }),
    );
    MOCKS.publishHomeserver.mockResolvedValue(Result.ok());
    MOCKS.resolvePubkyHomeserver.mockResolvedValue(Result.ok(OTHER_HOMESERVER));

    const result = await new LocalIdentityController(
      storedIdentityRepository(new Uint8Array(32).fill(7), OTHER_HOMESERVER),
    ).republishHomeserver(PUBLIC_KEY, OTHER_HOMESERVER);

    expect(expectResultOk(result)).toBe(OTHER_HOMESERVER);
    expect(MOCKS.publishHomeserver).toHaveBeenCalledWith(keyHandle, OTHER_HOMESERVER);
  });

  it("re-signs an existing record without repointing it", async () => {
    const keyHandle = {};
    MOCKS.resolveHomeserver.mockResolvedValue(Result.ok(OTHER_HOMESERVER));
    MOCKS.restoreIdentityKey.mockReturnValue(
      Result.ok({ keyHandle, publicIdentity: { publicKeyZ32: PUBLIC_KEY } }),
    );
    MOCKS.publishHomeserver.mockResolvedValue(Result.ok());
    MOCKS.resolvePubkyHomeserver.mockResolvedValue(Result.ok(OTHER_HOMESERVER));

    const result = await new LocalIdentityController(
      storedIdentityRepository(new Uint8Array(32).fill(7)),
    ).republishHomeserver(PUBLIC_KEY, HOMESERVER);

    expect(expectResultOk(result)).toBe(OTHER_HOMESERVER);
    expect(MOCKS.publishHomeserver).toHaveBeenCalledWith(keyHandle, null);
  });

  it("publishes nothing when the current record cannot be looked up", async () => {
    const secretBytes = new Uint8Array(32).fill(7);
    const lookupFailure = { code: "resolution_failed" as const };
    MOCKS.resolveHomeserver.mockResolvedValue(Result.err(lookupFailure));

    const result = await new LocalIdentityController(
      storedIdentityRepository(secretBytes),
    ).republishHomeserver(PUBLIC_KEY, HOMESERVER);

    expect(Result.isError(result) && result.error).toEqual({
      code: "resolution_failed",
      cause: lookupFailure,
    });
    expect(MOCKS.restoreIdentityKey).not.toHaveBeenCalled();
    expect(MOCKS.publishHomeserver).not.toHaveBeenCalled();
    expect(MOCKS.resolvePubkyHomeserver).not.toHaveBeenCalled();
    expect(secretBytes).toEqual(new Uint8Array(32));
    expect(MOCKS.dispose).toHaveBeenCalledOnce();
  });

  it.each([
    ["no record", Result.ok(null)],
    ["a failed lookup", Result.err({ code: "resolution_failed" as const })],
  ] as const)("reports a published record that still finds %s", async (_, verification) => {
    MOCKS.resolveHomeserver.mockResolvedValue(Result.ok(null));
    MOCKS.restoreIdentityKey.mockReturnValue(
      Result.ok({ keyHandle: {}, publicIdentity: { publicKeyZ32: PUBLIC_KEY } }),
    );
    MOCKS.publishHomeserver.mockResolvedValue(Result.ok());
    MOCKS.resolvePubkyHomeserver.mockResolvedValue(verification);

    const result = await new LocalIdentityController(
      storedIdentityRepository(new Uint8Array(32)),
    ).republishHomeserver(PUBLIC_KEY, HOMESERVER);

    expect(Result.isError(result) && result.error.code).toBe("still_unresolved");
  });

  it("maps a missing identity without creating the SDK", async () => {
    const repository = {
      ...storedIdentityRepository(new Uint8Array(32)),
      read: vi.fn(() => Result.err({ code: "storage_unavailable" as const })),
    };

    const result = await new LocalIdentityController(repository).republishHomeserver(
      PUBLIC_KEY,
      HOMESERVER,
    );

    expect(Result.isError(result) && result.error).toEqual({
      code: "identity_unavailable",
      cause: { code: "storage_unavailable" },
    });
    expect(MOCKS.resolveHomeserver).not.toHaveBeenCalled();
    expect(MOCKS.restoreIdentityKey).not.toHaveBeenCalled();
    expect(MOCKS.publishHomeserver).not.toHaveBeenCalled();
  });

  it.each(["failure", "exception"] as const)(
    "contains a republish %s and still clears and disposes",
    async (outcome) => {
      const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const secretBytes = new Uint8Array(32).fill(7);
      const repository = storedIdentityRepository(secretBytes);
      MOCKS.resolveHomeserver.mockResolvedValue(Result.ok(null));
      MOCKS.restoreIdentityKey.mockReturnValue(
        Result.ok({ keyHandle: {}, publicIdentity: { publicKeyZ32: PUBLIC_KEY } }),
      );
      MOCKS.publishHomeserver.mockImplementation(async () => {
        if (outcome === "exception") throw new Error("SECRET-REPUBLISH-CANARY");
        return Result.err({ code: "publish_failed" as const });
      });

      const result = await new LocalIdentityController(repository).republishHomeserver(
        PUBLIC_KEY,
        HOMESERVER,
      );

      expect(Result.isError(result) && result.error.code).toBe("publication_failed");
      expect(MOCKS.resolvePubkyHomeserver).not.toHaveBeenCalled();
      expect(secretBytes).toEqual(new Uint8Array(32));
      expect(MOCKS.dispose).toHaveBeenCalledOnce();
      expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-REPUBLISH-CANARY");
    },
  );
});

function storedIdentityRepository(secretBytes: Uint8Array, homeserverPubky?: string) {
  return {
    list: vi.fn(() => Result.ok({ activePublicKeyZ32: PUBLIC_KEY, identities: [] })),
    select: vi.fn(() => Result.ok()),
    remove: vi.fn(() => Result.ok()),
    subscribe: vi.fn(() => () => undefined),
    recordBackup: vi.fn(() => Result.ok()),
    read: vi.fn(() =>
      Result.ok({
        identity: {
          publicIdentity: { publicKeyZ32: PUBLIC_KEY },
          ...(homeserverPubky ? { homeserverPubky } : {}),
        },
        secretKey: {
          bytes: secretBytes,
          format: PUBKY_SECRET_KEY_FORMAT,
        } satisfies PubkySecretKeyMaterial,
      }),
    ),
  };
}
