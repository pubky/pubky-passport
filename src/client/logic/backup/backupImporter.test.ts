import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";
import { LOGGER } from "@/libs/logger/logger";
import type {
  PubkyIdentityKey,
  PubkyIdentityKeyHandle,
} from "@/client/logic/pubky/pubkyIdentityKey";
import { BackupImporter } from "./BackupImporter";
import { MAXIMUM_BACKUP_BYTES, MAXIMUM_BACKUP_PASSWORD_LENGTH } from "./BackupVerifier";

const PUBLIC_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const OTHER_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const HOMESERVER = "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";
const PASSWORD = "correct horse battery";

describe("BackupImporter", () => {
  it("signs in with the restored key, saves it without profile setup, and releases the handle", async () => {
    const { importer, pubky, repository } = setup();
    const bytes = new Uint8Array([7, 7]);

    expect(expectResultOk(await importer.importBackup(bytes, PASSWORD, HOMESERVER))).toEqual({
      status: "imported",
      identity: { publicIdentity: { publicKeyZ32: PUBLIC_KEY } },
    });
    expect(pubky.restoreRecoveryFile).toHaveBeenCalledWith(bytes, PASSWORD);
    expect(pubky.signin).toHaveBeenCalledWith("restored", "normal");
    expect(repository.save).toHaveBeenCalledOnce();
    expect(repository.save).toHaveBeenCalledWith(
      { publicIdentity: { publicKeyZ32: PUBLIC_KEY } },
      expect.objectContaining({ format: "pubky-secret-key" }),
    );
    expect(pubky.exportedSecrets[0]?.bytes.every((byte) => byte === 0)).toBe(true);
    expect(pubky.disposeIdentityKey).toHaveBeenCalledWith("restored");
    expect(pubky.resolveHomeserver).not.toHaveBeenCalled();
  });

  it("opens backups whose passphrase is shorter than the creation minimum", async () => {
    const { importer, pubky } = setup();
    expectResultOk(await importer.importBackup(new Uint8Array([7]), "pin", HOMESERVER));
    expect(pubky.restoreRecoveryFile).toHaveBeenCalledWith(expect.any(Uint8Array), "pin");
  });

  it.each([
    ["an empty password", new Uint8Array([7]), "", "invalid_password"],
    [
      "an over-long password",
      new Uint8Array([7]),
      "x".repeat(MAXIMUM_BACKUP_PASSWORD_LENGTH + 1),
      "invalid_password",
    ],
    ["an empty file", new Uint8Array(), PASSWORD, "invalid_backup"],
    [
      "an oversized file",
      new Uint8Array(MAXIMUM_BACKUP_BYTES + 1).fill(7),
      PASSWORD,
      "invalid_backup",
    ],
  ] as const)(
    "rejects %s before decrypting and clears the file",
    async (_, bytes, password, code) => {
      const { importer, pubky } = setup();
      expectResultError(await importer.importBackup(bytes, password, HOMESERVER), { code });
      expect(pubky.restoreRecoveryFile).not.toHaveBeenCalled();
      expect(bytes.every((byte) => byte === 0)).toBe(true);
    },
  );

  it("reports a wrong password or damaged file as a decryption failure", async () => {
    const { importer, pubky } = setup();
    const cause = { code: "restore_failed" };
    pubky.restoreRecoveryFile.mockReturnValueOnce(Result.err(cause) as never);
    expectResultError(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER), {
      code: "backup_decryption_failed",
      cause,
    });
    expect(pubky.signin).not.toHaveBeenCalled();
  });

  it.each([
    [{ publicIdentity: { publicKeyZ32: PUBLIC_KEY } }, "already_present"],
    [{ publicIdentity: { publicKeyZ32: PUBLIC_KEY }, keySource: "ring" }, "external_key"],
  ] as const)("refuses to replace a saved entry before signing in: %s", async (existing, code) => {
    const { importer, pubky, repository } = setup({ identities: [existing] });
    expectResultError(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER), {
      code,
    });
    expect(pubky.signin).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(pubky.disposeIdentityKey).toHaveBeenCalledWith("restored");
  });

  it("rechecks the catalog after sign-in so a concurrent save is not overwritten", async () => {
    const { importer, repository } = setup();
    repository.list
      .mockReturnValueOnce(Result.ok({ activePublicKeyZ32: null, identities: [] }))
      .mockReturnValueOnce(
        Result.ok({
          activePublicKeyZ32: PUBLIC_KEY,
          identities: [{ publicIdentity: { publicKeyZ32: PUBLIC_KEY } }],
        }),
      );
    expectResultError(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER), {
      code: "already_present",
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("reports a sign-in failure for a key whose record resolves and saves nothing", async () => {
    const { importer, pubky, repository } = setup();
    const cause = { code: "signin_failed" };
    pubky.signin.mockResolvedValueOnce(Result.err(cause) as never);
    expectResultError(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER), {
      code: "signin_failed",
      cause,
    });
    expect(pubky.resolveHomeserver.mock.calls).toEqual([[PUBLIC_KEY]]);
    expect(pubky.publishHomeserver).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(pubky.disposeIdentityKey).toHaveBeenCalledWith("restored");
    expectResultError(await importer.republishHomeserver(HOMESERVER), {
      code: "import_unavailable",
    });
  });

  it("never treats a failed lookup as a missing record", async () => {
    const { importer, pubky, repository } = setup();
    const cause = { code: "resolution_failed" };
    pubky.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }) as never);
    pubky.resolveHomeserver.mockResolvedValueOnce(Result.err(cause) as never);

    expectResultError(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER), {
      code: "resolution_failed",
      cause,
    });
    // Only the backup's own key is looked up; no other record stands in for it.
    expect(pubky.resolveHomeserver.mock.calls).toEqual([[PUBLIC_KEY]]);
    expect(repository.save).not.toHaveBeenCalled();
    expect(pubky.disposeIdentityKey).toHaveBeenCalledWith("restored");
    expectResultError(await importer.republishHomeserver(HOMESERVER), {
      code: "import_unavailable",
    });
    expect(pubky.publishHomeserver).not.toHaveBeenCalled();
  });

  it("offers no record repair when the provider has no homeserver", async () => {
    const { importer, pubky, repository } = setup();
    const cause = { code: "signin_failed" };
    pubky.signin.mockResolvedValueOnce(Result.err(cause) as never);
    pubky.resolveHomeserver.mockResolvedValue(Result.ok(null) as never);

    expectResultError(await importer.importBackup(new Uint8Array([7]), PASSWORD, null), {
      code: "signin_failed",
      cause,
    });
    expect(pubky.resolveHomeserver).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(pubky.disposeIdentityKey).toHaveBeenCalledWith("restored");
  });

  it("refuses a sign-in that returns a different identity", async () => {
    const { importer, pubky, repository } = setup();
    pubky.signin.mockResolvedValueOnce(Result.ok({ publicIdentity: { publicKeyZ32: OTHER_KEY } }));
    expectResultError(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER), {
      code: "signin_failed",
    });
    expect(repository.save).not.toHaveBeenCalled();
    expect(pubky.disposeIdentityKey).toHaveBeenCalledWith("restored");
  });

  it.each(["list", "export", "save"] as const)(
    "reports a storage failure while saving: %s",
    async (failing) => {
      const { importer, pubky, repository } = setup();
      const cause = { code: "storage_unavailable" };
      if (failing === "list") {
        repository.list
          .mockReturnValueOnce(Result.ok({ activePublicKeyZ32: null, identities: [] }))
          .mockReturnValueOnce(Result.err(cause) as never);
      }
      if (failing === "export")
        pubky.exportSecretKey.mockReturnValueOnce(Result.err(cause) as never);
      if (failing === "save") repository.save.mockReturnValueOnce(Result.err(cause) as never);
      expectResultError(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER), {
        code: "storage_failed",
        cause,
      });
      expect(pubky.disposeIdentityKey).toHaveBeenCalledWith("restored");
    },
  );

  describe("when the network has no homeserver record for the key", () => {
    function missingRecord() {
      const context = setup();
      context.pubky.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }) as never);
      context.pubky.resolveHomeserver.mockResolvedValue(Result.ok(null));
      return context;
    }

    it("holds the key until the confirmed homeserver is published, then saves it", async () => {
      const { importer, pubky, repository } = missingRecord();

      expect(
        expectResultOk(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER)),
      ).toEqual({
        status: "homeserver_record_missing",
        publicIdentity: { publicKeyZ32: PUBLIC_KEY },
      });
      expect(pubky.resolveHomeserver.mock.calls).toEqual([[PUBLIC_KEY]]);
      expect(repository.save).not.toHaveBeenCalled();
      expect(pubky.publishHomeserver).not.toHaveBeenCalled();
      expect(pubky.disposeIdentityKey).not.toHaveBeenCalled();

      expect(expectResultOk(await importer.republishHomeserver(HOMESERVER))).toEqual({
        publicIdentity: { publicKeyZ32: PUBLIC_KEY },
        homeserverPubky: HOMESERVER,
      });
      // The record is looked up again right before publishing, not taken from the import.
      expect(pubky.resolveHomeserver.mock.calls).toEqual([[PUBLIC_KEY], [PUBLIC_KEY]]);
      expect(pubky.publishHomeserver).toHaveBeenCalledWith("restored", HOMESERVER);
      expect(pubky.signin).toHaveBeenLastCalledWith("restored", "after-publication");
      expect(repository.save).toHaveBeenCalledOnce();
      expect(pubky.disposeIdentityKey).toHaveBeenCalledWith("restored");
      expectResultError(await importer.republishHomeserver(HOMESERVER), {
        code: "import_unavailable",
      });
    });

    it("keeps the key and publishes nothing when the lookup before publishing fails", async () => {
      const { importer, pubky, repository } = missingRecord();
      expectResultOk(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER));

      const cause = { code: "resolution_failed" };
      pubky.resolveHomeserver.mockResolvedValueOnce(Result.err(cause) as never);
      expectResultError(await importer.republishHomeserver(HOMESERVER), {
        code: "resolution_failed",
        cause,
      });
      expect(pubky.publishHomeserver).not.toHaveBeenCalled();
      expect(pubky.signin).toHaveBeenCalledOnce();
      expect(pubky.disposeIdentityKey).not.toHaveBeenCalled();

      expectResultOk(await importer.republishHomeserver(HOMESERVER));
      expect(pubky.publishHomeserver).toHaveBeenCalledOnce();
      expect(repository.save).toHaveBeenCalledOnce();
    });

    it("signs in without publishing when the record came back for the confirmed homeserver", async () => {
      const { importer, pubky, repository } = missingRecord();
      expectResultOk(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER));

      pubky.resolveHomeserver.mockResolvedValueOnce(Result.ok(HOMESERVER));
      expect(expectResultOk(await importer.republishHomeserver(HOMESERVER))).toEqual({
        publicIdentity: { publicKeyZ32: PUBLIC_KEY },
        homeserverPubky: HOMESERVER,
      });
      expect(pubky.publishHomeserver).not.toHaveBeenCalled();
      expect(pubky.signin).toHaveBeenLastCalledWith("restored", "after-publication");
      expect(repository.save).toHaveBeenCalledOnce();
      expect(pubky.disposeIdentityKey).toHaveBeenCalledWith("restored");
    });

    it("publishes nothing over a record that came back for another homeserver", async () => {
      const { importer, pubky, repository } = missingRecord();
      expectResultOk(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER));

      pubky.resolveHomeserver.mockResolvedValueOnce(Result.ok(OTHER_KEY));
      expectResultError(await importer.republishHomeserver(HOMESERVER), {
        code: "homeserver_record_found",
      });
      expect(pubky.publishHomeserver).not.toHaveBeenCalled();
      expect(pubky.signin).toHaveBeenCalledOnce();
      expect(repository.save).not.toHaveBeenCalled();
      expect(pubky.disposeIdentityKey).toHaveBeenCalledWith("restored");
      expectResultError(await importer.republishHomeserver(HOMESERVER), {
        code: "import_unavailable",
      });
    });

    it("ignores a lookup that completes after the key was discarded", async () => {
      const { importer, pubky } = missingRecord();
      expectResultOk(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER));
      const lookup = Promise.withResolvers<ReturnType<typeof Result.ok<null>>>();
      pubky.resolveHomeserver.mockReturnValueOnce(lookup.promise as never);
      const republished = importer.republishHomeserver(HOMESERVER);
      importer.discardPending();
      lookup.resolve(Result.ok(null));
      expectResultError(await republished, { code: "import_unavailable" });
      expect(pubky.publishHomeserver).not.toHaveBeenCalled();
    });

    it("keeps the key for a retry when publishing or the following sign-in fails", async () => {
      const { importer, pubky, repository } = missingRecord();
      expectResultOk(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER));

      const publishFailure = { code: "publish_failed" };
      pubky.publishHomeserver.mockResolvedValueOnce(Result.err(publishFailure) as never);
      expectResultError(await importer.republishHomeserver(HOMESERVER), {
        code: "publish_failed",
        cause: publishFailure,
      });
      expect(pubky.signin).toHaveBeenCalledOnce();

      pubky.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }) as never);
      expectResultError(
        await importer.republishHomeserver(HOMESERVER),
        expect.objectContaining({ code: "signin_failed" }),
      );
      expect(pubky.disposeIdentityKey).not.toHaveBeenCalled();

      expectResultOk(await importer.republishHomeserver(HOMESERVER));
      expect(repository.save).toHaveBeenCalledOnce();
    });

    it("releases the waiting key when the person leaves or starts another import", async () => {
      const { importer, pubky } = missingRecord();
      expectResultOk(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER));
      importer.discardPending();
      expect(pubky.disposeIdentityKey).toHaveBeenCalledWith("restored");
      expectResultError(await importer.republishHomeserver(HOMESERVER), {
        code: "import_unavailable",
      });

      pubky.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }) as never);
      pubky.resolveHomeserver.mockResolvedValueOnce(Result.ok(null));
      pubky.restoreRecoveryFile.mockReturnValueOnce(Result.ok(identity(PUBLIC_KEY, "second")));
      expectResultOk(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER));
      pubky.restoreRecoveryFile.mockReturnValueOnce(Result.ok(identity(PUBLIC_KEY, "third")));
      expectResultOk(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER));
      expect(pubky.disposeIdentityKey).toHaveBeenCalledWith("second");
    });

    it("ignores a publication that completes after the key was discarded", async () => {
      const { importer, pubky, repository } = missingRecord();
      expectResultOk(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER));
      const publication = Promise.withResolvers<ReturnType<typeof Result.ok>>();
      pubky.publishHomeserver.mockReturnValueOnce(publication.promise as never);
      const republished = importer.republishHomeserver(HOMESERVER);
      importer.discardPending();
      publication.resolve(Result.ok());
      expectResultError(await republished, { code: "import_unavailable" });
      expect(pubky.signin).toHaveBeenCalledOnce();
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  it("releases every key on dispose and refuses later imports", async () => {
    const { importer, pubky } = setup();
    pubky.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }) as never);
    pubky.resolveHomeserver.mockResolvedValueOnce(Result.ok(null));
    expectResultOk(await importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER));
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    pubky.dispose.mockImplementationOnce(() => {
      throw new Error("free failed");
    });

    importer.dispose();
    importer.dispose();
    expect(pubky.disposeIdentityKey).toHaveBeenCalledWith("restored");
    expect(pubky.dispose).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "identity.backup_import.cleanup.failed",
      expect.objectContaining({ operation: "pubky_dispose" }),
    );
    const bytes = new Uint8Array([7]);
    expectResultError(await importer.importBackup(bytes, PASSWORD, HOMESERVER), {
      code: "import_unavailable",
    });
    expect(bytes[0]).toBe(0);
    warning.mockRestore();
  });

  it("holds nothing when disposed while looking up the record", async () => {
    const { importer, pubky, repository } = setup();
    pubky.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }) as never);
    const lookup = Promise.withResolvers<ReturnType<typeof Result.ok<null>>>();
    pubky.resolveHomeserver.mockReturnValueOnce(lookup.promise as never);
    const imported = importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER);
    await vi.waitFor(() => expect(pubky.resolveHomeserver).toHaveBeenCalledOnce());
    importer.dispose();
    lookup.resolve(Result.ok(null));
    expectResultError(await imported, { code: "import_unavailable" });
    expect(pubky.disposeIdentityKey).toHaveBeenCalledWith("restored");
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("saves nothing when disposed while signing in", async () => {
    const { importer, pubky, repository } = setup();
    const signin = Promise.withResolvers<ReturnType<typeof Result.ok>>();
    pubky.signin.mockReturnValueOnce(signin.promise as never);
    const imported = importer.importBackup(new Uint8Array([7]), PASSWORD, HOMESERVER);
    importer.dispose();
    signin.resolve(Result.ok({ publicIdentity: { publicKeyZ32: PUBLIC_KEY } }));
    expectResultError(await imported, { code: "import_unavailable" });
    expect(repository.save).not.toHaveBeenCalled();
  });
});

function setup({ identities = [] }: { identities?: ReadonlyArray<Record<string, unknown>> } = {}) {
  const exportedSecrets: Array<{ bytes: Uint8Array; format: "pubky-secret-key" }> = [];
  const pubky = {
    exportedSecrets,
    dispose: vi.fn(),
    disposeIdentityKey: vi.fn(),
    exportSecretKey: vi.fn(() => {
      const secret = { bytes: new Uint8Array(32).fill(1), format: "pubky-secret-key" as const };
      exportedSecrets.push(secret);
      return Result.ok(secret);
    }),
    publishHomeserver: vi.fn(async () => Result.ok()),
    resolveHomeserver: vi.fn(async () => Result.ok<string | null>(HOMESERVER)),
    restoreRecoveryFile: vi.fn(() => Result.ok(identity(PUBLIC_KEY, "restored"))),
    signin: vi.fn(async () => Result.ok({ publicIdentity: { publicKeyZ32: PUBLIC_KEY } })),
  };
  const repository = {
    list: vi.fn(() =>
      Result.ok<{
        activePublicKeyZ32: string | null;
        identities: ReadonlyArray<Record<string, unknown>>;
      }>({ activePublicKeyZ32: null, identities }),
    ),
    save: vi.fn((metadata: unknown) => Result.ok(metadata)),
  };
  return {
    importer: new BackupImporter(pubky as never, repository as never),
    pubky,
    repository,
  };
}

function identity(publicKeyZ32: string, handle: string): PubkyIdentityKey {
  return {
    keyHandle: handle as unknown as PubkyIdentityKeyHandle,
    publicIdentity: { publicKeyZ32 },
  };
}
