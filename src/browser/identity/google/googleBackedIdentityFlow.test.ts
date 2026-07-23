import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { FakePubkyIdentityKeys } from "../../../../test-utils/fakes/fakePubkyIdentityKeys";
import { FakePubkyDiscovery } from "../../../../test-utils/fakes/fakePubkyDiscovery";
import { FakePubkySignup } from "../../../../test-utils/fakes/fakePubkySignup";
import type { LocalIdentitySaver } from "../localIdentityService";
import type {
  PassportFileCrypto,
  PassportFileCryptoResult,
  PassportFileReference,
  PassportFileStore,
  PassportFileStoreErrorCode,
} from "../../passport-file/ports";
import type { PassportFileEnvelopeV1 } from "../../../features/passport-file/passportFile";
import { GoogleBackedIdentityFlow } from "./googleBackedIdentityFlow";
import { CreateMissingGoogleDriveIdentityUseCase } from "./createMissingGoogleDriveIdentity";
import { DeleteGoogleBackedIdentity } from "./deleteGoogleBackedIdentity";
import type { GoogleHomegateInviteRequester, GoogleHomegateInviteRequesterErrorCode } from "./ports";
import { RestoreExistingGoogleDriveIdentityUseCase } from "./restoreExistingGoogleDriveIdentity";

const envelope: PassportFileEnvelopeV1 = {
  v: 1,
  iv: "a".repeat(16),
  ct: "b".repeat(64),
  url: "https://passport.pubky.app",
};
const reference: PassportFileReference = { storageId: "opaque-file-id", revision: "42" };

describe("GoogleBackedIdentityFlow", () => {
  it("restores a Drive identity and saves it locally", async () => {
    const keys = new FakePubkyIdentityKeys();
    const local = new FakeLocalIdentities();
    const files = new FakePassportFiles({ status: "found", envelope, reference });
    const crypto = new FakePassportCrypto();
    const dependencies = activationDependencies(keys);
    const flow = createFlow({ keys, local, files, crypto, ...dependencies });

    const result = await flow.establish({ googleIdToken: "id-token", driveAccessToken: "drive-token" });

    expect(Result.isError(result)).toBe(false);
    expect(keys.createCalls).toBe(0);
    expect(keys.restoreCalls).toHaveLength(1);
    expect(local.savedHandles).toHaveLength(1);
    expect(dependencies.signup.signinCalls).toEqual([{ keyHandle: local.savedHandles[0], waitForDiscovery: true }]);
    expect(dependencies.homegate.calls).toEqual([]);
    expect(dependencies.discovery.calls).toEqual([]);
    expect(crypto.decryptedBytes.every((byte) => byte === 0)).toBe(true);
    expect(keys.disposedKeys).toEqual([]);
  });

  it("creates, encrypts, writes, and then saves a missing Drive identity", async () => {
    const keys = new FakePubkyIdentityKeys();
    const local = new FakeLocalIdentities();
    const files = new FakePassportFiles({ status: "missing" });
    const crypto = new FakePassportCrypto();
    const dependencies = activationDependencies(keys);
    const flow = createFlow({ keys, local, files, crypto, ...dependencies });

    const result = await flow.establish({ googleIdToken: "id-token", driveAccessToken: "drive-token" });

    expect(Result.isError(result)).toBe(false);
    expect(keys.createCalls).toBe(1);
    expect(files.written).toEqual([envelope]);
    expect(local.savedHandles).toHaveLength(1);
    expect(dependencies.homegate.calls).toEqual([{ googleIdToken: "id-token" }]);
    expect(dependencies.signup.signupCalls).toEqual([{
      keyHandle: local.savedHandles[0],
      homeserverPubky: "homegate-homeserver",
      hasSignupCode: true,
    }]);
    expect(dependencies.discovery.calls).toEqual([{
      keyHandle: local.savedHandles[0],
      homeserverPubky: "homegate-homeserver",
    }]);
    expect(crypto.encryptedBytes.every((byte) => byte === 0)).toBe(true);
    expect(keys.disposedKeys).toEqual([]);
  });

  it("deletes a Drive identity only when it matches the selected local identity", async () => {
    const keys = new FakePubkyIdentityKeys();
    const files = new FakePassportFiles({ status: "found", envelope, reference });
    const crypto = new FakePassportCrypto();
    const deletion = createDeletion({ keys, files, crypto });

    const deleted = await deletion.execute(
      { googleIdToken: "id-token", driveAccessToken: "drive-token" },
      keys.nextPublicIdentity.publicKeyZ32,
    );

    expect(Result.isError(deleted)).toBe(false);
    expect(files.deleteCalls).toBe(1);
    expect(files.deletedReferences).toEqual([reference]);
    expect(keys.disposedKeys).toHaveLength(1);
    expect(crypto.decryptedBytes.every((byte) => byte === 0)).toBe(true);
  });

  it("does not delete a Drive identity that differs from the selected identity", async () => {
    const keys = new FakePubkyIdentityKeys();
    const files = new FakePassportFiles({ status: "found", envelope, reference });
    const deletion = createDeletion({ keys, files, crypto: new FakePassportCrypto() });

    const deleted = await deletion.execute(
      { googleIdToken: "id-token", driveAccessToken: "drive-token" },
      "different-local-identity",
    );

    expect(Result.isError(deleted)).toBe(true);
    if (Result.isError(deleted)) expect(deleted.error).toEqual({ code: "identity_mismatch" });
    expect(files.deleteCalls).toBe(0);
  });

  it("maps a create conflict and disposes the unpersisted key", async () => {
    const keys = new FakePubkyIdentityKeys();
    const files = new FakePassportFiles({ status: "missing" });
    files.createFailure = "create_conflict";
    const crypto = new FakePassportCrypto();
    const flow = createFlow({ keys, local: new FakeLocalIdentities(), files, crypto });

    const result = await flow.establish({ googleIdToken: "id-token", driveAccessToken: "drive-token" });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "drive_create_conflict" });
    expect(keys.disposedKeys).toHaveLength(1);
    expect(crypto.encryptedBytes.every((byte) => byte === 0)).toBe(true);
  });

  it.each(["encrypt", "drive-write"] as const)(
    "does not expose a recoverable identity when %s fails before a Drive file exists",
    async (stage) => {
      const keys = new FakePubkyIdentityKeys();
      const files = new FakePassportFiles({ status: "missing" });
      const crypto = new FakePassportCrypto();
      if (stage === "encrypt") {
        crypto.encryptSecretKeyBytes = async (input) => {
          crypto.encryptedBytes = input.secretKeyBytes;
          return Result.err({ code: "encrypt_failed" });
        };
      } else {
        files.createFailure = "write_failed";
      }
      const flow = createFlow({ keys, local: new FakeLocalIdentities(), files, crypto });

      const result = await flow.establish({ googleIdToken: "id-token", driveAccessToken: "drive-token" });

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) expect(result.error.recoverablePublicIdentity).toBeUndefined();
      expect(keys.disposedKeys).toHaveLength(1);
      expect(crypto.encryptedBytes.every((byte) => byte === 0)).toBe(true);
    },
  );

  it("maps stale deletion and still disposes and zeroes restored key material", async () => {
    const keys = new FakePubkyIdentityKeys();
    const files = new FakePassportFiles({ status: "found", envelope, reference });
    files.deleteFailure = "stale_file";
    const crypto = new FakePassportCrypto();
    const deletion = createDeletion({ keys, files, crypto });

    const result = await deletion.execute(
      { googleIdToken: "id-token", driveAccessToken: "drive-token" },
      keys.nextPublicIdentity.publicKeyZ32,
    );

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "drive_stale_file" });
    expect(keys.disposedKeys).toHaveLength(1);
    expect(crypto.decryptedBytes.every((byte) => byte === 0)).toBe(true);
  });

  it("performs created activation in order and sends only the Google ID token to Homegate", async () => {
    const events: string[] = [];
    const keys = new FakePubkyIdentityKeys();
    const local = new FakeLocalIdentities(() => events.push("save"));
    const files = new FakePassportFiles({ status: "missing" }, () => events.push("drive-create"));
    const homegate = new FakeHomegateInvites(() => events.push("homegate"));
    const signup = new FakePubkySignup();
    signup.session.publicIdentity = keys.nextPublicIdentity;
    const originalSignup = signup.signup.bind(signup);
    signup.signup = async (input) => {
      events.push("signup");
      return originalSignup(input);
    };
    const discovery = new FakePubkyDiscovery();
    const originalPublish = discovery.publishHomeserverIfStale.bind(discovery);
    discovery.publishHomeserverIfStale = async (input) => {
      events.push("discovery");
      return originalPublish(input);
    };
    const flow = createFlow({ keys, local, files, crypto: new FakePassportCrypto(), homegate, signup, discovery });

    await flow.establish({ googleIdToken: "id-token", driveAccessToken: "drive-token" });

    expect(events).toEqual(["drive-create", "homegate", "signup", "discovery", "save"]);
    expect(homegate.calls).toEqual([{ googleIdToken: "id-token" }]);
  });

  it("stops after created activation failure without saving locally and disposes the key", async () => {
    const keys = new FakePubkyIdentityKeys();
    const local = new FakeLocalIdentities();
    const dependencies = activationDependencies(keys);
    dependencies.signup.signupFailure = "signup_failed";
    const flow = createFlow({
      keys,
      local,
      files: new FakePassportFiles({ status: "missing" }),
      crypto: new FakePassportCrypto(),
      ...dependencies,
    });

    const result = await flow.establish({ googleIdToken: "id-token", driveAccessToken: "drive-token" });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({
      code: "signup_failed",
      recoverablePublicIdentity: keys.nextPublicIdentity,
    });
    expect(dependencies.discovery.calls).toEqual([]);
    expect(local.savedHandles).toEqual([]);
    expect(keys.disposedKeys).toHaveLength(1);
  });

  it("stops before signup when Homegate fails", async () => {
    const keys = new FakePubkyIdentityKeys();
    const local = new FakeLocalIdentities();
    const dependencies = activationDependencies(keys);
    dependencies.homegate.failure = "homegate_unavailable";
    const flow = createFlow({
      keys,
      local,
      files: new FakePassportFiles({ status: "missing" }),
      crypto: new FakePassportCrypto(),
      ...dependencies,
    });

    const result = await flow.establish({ googleIdToken: "id-token", driveAccessToken: "drive-token" });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({
      code: "homegate_invite_failed",
      recoverablePublicIdentity: keys.nextPublicIdentity,
    });
    expect(dependencies.signup.signupCalls).toEqual([]);
    expect(dependencies.discovery.calls).toEqual([]);
    expect(local.savedHandles).toEqual([]);
    expect(keys.disposedKeys).toHaveLength(1);
  });

  it("rejects a signup session for a different identity before discovery or local save", async () => {
    const keys = new FakePubkyIdentityKeys();
    const local = new FakeLocalIdentities();
    const dependencies = activationDependencies(keys);
    dependencies.signup.session.publicIdentity = {
      publicKeyZ32: "different-session-identity",
      publicKeyDisplay: "pubkydifferent-session-identity",
    };
    const flow = createFlow({
      keys,
      local,
      files: new FakePassportFiles({ status: "missing" }),
      crypto: new FakePassportCrypto(),
      ...dependencies,
    });

    const result = await flow.establish({ googleIdToken: "id-token", driveAccessToken: "drive-token" });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({
      code: "identity_mismatch",
      recoverablePublicIdentity: keys.nextPublicIdentity,
    });
    expect(dependencies.discovery.calls).toEqual([]);
    expect(local.savedHandles).toEqual([]);
    expect(keys.disposedKeys).toHaveLength(1);
  });

  it("does not save locally when discovery publication fails", async () => {
    const keys = new FakePubkyIdentityKeys();
    const local = new FakeLocalIdentities();
    const dependencies = activationDependencies(keys);
    dependencies.discovery.ifStaleFailure = "publish_failed";
    const flow = createFlow({
      keys,
      local,
      files: new FakePassportFiles({ status: "missing" }),
      crypto: new FakePassportCrypto(),
      ...dependencies,
    });

    const result = await flow.establish({ googleIdToken: "id-token", driveAccessToken: "drive-token" });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({
      code: "discovery_failed",
      recoverablePublicIdentity: keys.nextPublicIdentity,
    });
    expect(local.savedHandles).toEqual([]);
    expect(keys.disposedKeys).toHaveLength(1);
  });

  it("stops restored activation failure without requesting Homegate or saving locally", async () => {
    const keys = new FakePubkyIdentityKeys();
    const local = new FakeLocalIdentities();
    const dependencies = activationDependencies(keys);
    dependencies.signup.signinFailure = "signin_failed";
    const flow = createFlow({
      keys,
      local,
      files: new FakePassportFiles({ status: "found", envelope, reference }),
      crypto: new FakePassportCrypto(),
      ...dependencies,
    });

    const result = await flow.establish({ googleIdToken: "id-token", driveAccessToken: "drive-token" });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({
      code: "signin_failed",
      recoverablePublicIdentity: keys.nextPublicIdentity,
    });
    expect(dependencies.homegate.calls).toEqual([]);
    expect(local.savedHandles).toEqual([]);
    expect(keys.disposedKeys).toHaveLength(1);
  });

  it.each(["signin", "local-save"] as const)(
    "disposes a restored key once and zeroes decrypted bytes when %s throws",
    async (stage) => {
      const keys = new FakePubkyIdentityKeys();
      const local = new FakeLocalIdentities();
      const crypto = new FakePassportCrypto();
      const dependencies = activationDependencies(keys);
      if (stage === "signin") {
        dependencies.signup.signin = async () => { throw new Error("signin threw"); };
      } else {
        local.throwOnSave = true;
      }
      const flow = createFlow({
        keys,
        local,
        files: new FakePassportFiles({ status: "found", envelope, reference }),
        crypto,
        ...dependencies,
      });

      const result = await flow.establish({ googleIdToken: "id-token", driveAccessToken: "drive-token" });

      expect(Result.isError(result) && result.error.code).toBe("unexpected_failure");
      expect(keys.disposedKeys).toHaveLength(1);
      expect(crypto.decryptedBytes.every((byte) => byte === 0)).toBe(true);
    },
  );

  it.each(["encrypt", "drive-write", "homegate", "signup", "discovery", "local-save"] as const)(
    "disposes a created key once and zeroes exported bytes when %s throws",
    async (stage) => {
      const keys = new FakePubkyIdentityKeys();
      const local = new FakeLocalIdentities();
      const files = new FakePassportFiles({ status: "missing" });
      const crypto = new FakePassportCrypto();
      const dependencies = activationDependencies(keys);

      if (stage === "encrypt") {
        crypto.encryptSecretKeyBytes = async (input) => {
          crypto.encryptedBytes = input.secretKeyBytes;
          throw new Error("encryption threw");
        };
      } else if (stage === "drive-write") {
        files.createPassportFile = async () => { throw new Error("Drive write threw"); };
      } else if (stage === "homegate") {
        dependencies.homegate.requestSignupInvitation = async () => { throw new Error("Homegate threw"); };
      } else if (stage === "signup") {
        dependencies.signup.signup = async () => { throw new Error("signup threw"); };
      } else if (stage === "discovery") {
        dependencies.discovery.publishHomeserverIfStale = async () => { throw new Error("discovery threw"); };
      } else {
        local.throwOnSave = true;
      }

      const flow = createFlow({ keys, local, files, crypto, ...dependencies });

      const result = await flow.establish({ googleIdToken: "id-token", driveAccessToken: "drive-token" });

      expect(Result.isError(result) && result.error.code).toBe("unexpected_failure");
      expect(keys.disposedKeys).toHaveLength(1);
      expect(crypto.encryptedBytes.every((byte) => byte === 0)).toBe(true);
    },
  );

  it("maps unexpected Drive deletion exceptions and still cleans restored key material", async () => {
    const keys = new FakePubkyIdentityKeys();
    const files = new FakePassportFiles({ status: "found", envelope, reference });
    files.deletePassportFile = async () => { throw new Error("Drive deletion threw"); };
    const crypto = new FakePassportCrypto();
    const deletion = createDeletion({ keys, files, crypto });

    const result = await deletion.execute(
      { googleIdToken: "id-token", driveAccessToken: "drive-token" },
      keys.nextPublicIdentity.publicKeyZ32,
    );

    expect(Result.isError(result) && result.error.code).toBe("unexpected_failure");
    expect(keys.disposedKeys).toHaveLength(1);
    expect(crypto.decryptedBytes.every((byte) => byte === 0)).toBe(true);
  });

  it("preserves create, restore, and delete outcomes when key cleanup throws", async () => {
    const createKeys = new FakePubkyIdentityKeys();
    createKeys.disposeIdentityKey = () => { throw new Error("cleanup failed"); };
    const createFiles = new FakePassportFiles({ status: "missing" });
    createFiles.createFailure = "create_conflict";
    const created = await createFlow({
      keys: createKeys,
      local: new FakeLocalIdentities(),
      files: createFiles,
      crypto: new FakePassportCrypto(),
    }).establish({ googleIdToken: "id-token", driveAccessToken: "drive-token" });
    expect(Result.isError(created) && created.error.code).toBe("drive_create_conflict");

    const restoreKeys = new FakePubkyIdentityKeys();
    restoreKeys.disposeIdentityKey = () => { throw new Error("cleanup failed"); };
    const restoreDependencies = activationDependencies(restoreKeys);
    restoreDependencies.signup.signinFailure = "signin_failed";
    const restored = await createFlow({
      keys: restoreKeys,
      local: new FakeLocalIdentities(),
      files: new FakePassportFiles({ status: "found", envelope, reference }),
      crypto: new FakePassportCrypto(),
      ...restoreDependencies,
    }).establish({ googleIdToken: "id-token", driveAccessToken: "drive-token" });
    expect(Result.isError(restored) && restored.error.code).toBe("signin_failed");

    const deleteKeys = new FakePubkyIdentityKeys();
    deleteKeys.disposeIdentityKey = () => { throw new Error("cleanup failed"); };
    const deleted = await createDeletion({
      keys: deleteKeys,
      files: new FakePassportFiles({ status: "found", envelope, reference }),
      crypto: new FakePassportCrypto(),
    }).execute(
      { googleIdToken: "id-token", driveAccessToken: "drive-token" },
      deleteKeys.nextPublicIdentity.publicKeyZ32,
    );
    expect(Result.isError(deleted)).toBe(false);
  });

});

function createFlow(input: {
  keys: FakePubkyIdentityKeys;
  local: FakeLocalIdentities;
  files: FakePassportFiles;
  crypto: FakePassportCrypto;
  homegate?: FakeHomegateInvites;
  signup?: FakePubkySignup;
  discovery?: FakePubkyDiscovery;
}): GoogleBackedIdentityFlow {
  const activation = activationDependencies(input.keys);
  const signup = input.signup ?? activation.signup;
  return new GoogleBackedIdentityFlow({
    wrappingKeys: { async requestWrappingKey() { return Result.ok("w".repeat(43)); } },
    passportFilesForAccessToken(accessToken) {
      expect(accessToken).toBe("drive-token");
      return input.files;
    },
    restoreExistingIdentity: new RestoreExistingGoogleDriveIdentityUseCase({
      crypto: input.crypto,
      identityKeys: input.keys,
      signup,
      localIdentities: input.local,
      passportUrl: "https://passport.pubky.app",
    }),
    createMissingIdentity: new CreateMissingGoogleDriveIdentityUseCase({
      crypto: input.crypto,
      identityKeys: input.keys,
      homegateInvites: input.homegate ?? activation.homegate,
      signup,
      discovery: input.discovery ?? activation.discovery,
      localIdentities: input.local,
      passportUrl: "https://passport.pubky.app",
    }),
  });
}

function createDeletion(input: {
  keys: FakePubkyIdentityKeys;
  files: FakePassportFiles;
  crypto: FakePassportCrypto;
}): DeleteGoogleBackedIdentity {
  return new DeleteGoogleBackedIdentity({
    wrappingKeys: { async requestWrappingKey() { return Result.ok("w".repeat(43)); } },
    passportFilesForAccessToken(accessToken) {
      expect(accessToken).toBe("drive-token");
      return input.files;
    },
    crypto: input.crypto,
    identityKeys: input.keys,
    passportUrl: "https://passport.pubky.app",
  });
}

class FakePassportFiles implements PassportFileStore {
  written: PassportFileEnvelopeV1[] = [];
  deleteCalls = 0;
  deletedReferences: PassportFileReference[] = [];
  createFailure?: PassportFileStoreErrorCode;
  deleteFailure?: PassportFileStoreErrorCode;
  constructor(
    private readonly readResult: { status: "found"; envelope: PassportFileEnvelopeV1; reference: PassportFileReference } | { status: "missing" } | { code: "invalid_file" },
    private readonly onCreate?: () => void,
  ) {}
  async readPassportFile() {
    return "code" in this.readResult ? Result.err(this.readResult) : Result.ok(this.readResult);
  }
  async createPassportFile(input: { envelope: PassportFileEnvelopeV1 }) {
    this.onCreate?.();
    this.written.push(input.envelope);
    return this.createFailure ? Result.err({ code: this.createFailure }) : Result.ok(reference);
  }
  async deletePassportFile(input: { reference: PassportFileReference }) {
    this.deleteCalls += 1;
    this.deletedReferences.push(input.reference);
    return this.deleteFailure ? Result.err({ code: this.deleteFailure }) : Result.ok();
  }
}

class FakePassportCrypto implements PassportFileCrypto {
  decryptedBytes: Uint8Array<ArrayBuffer> = new Uint8Array(32).fill(7);
  encryptedBytes: Uint8Array<ArrayBufferLike> = new Uint8Array(32);
  async decryptSecretKeyBytes() { return Result.ok(this.decryptedBytes); }
  async encryptSecretKeyBytes(input: { secretKeyBytes: Uint8Array }): Promise<PassportFileCryptoResult<PassportFileEnvelopeV1>> {
    this.encryptedBytes = input.secretKeyBytes;
    return Result.ok(envelope);
  }
}

class FakeLocalIdentities implements LocalIdentitySaver {
  savedHandles: unknown[] = [];
  throwOnSave = false;
  constructor(private readonly onSave?: () => void) {}
  async saveIdentity(input: Parameters<LocalIdentitySaver["saveIdentity"]>[0]) {
    if (this.throwOnSave) throw new Error("local save threw");
    this.onSave?.();
    this.savedHandles.push(input.keyHandle);
    return Result.ok({ id: "fake", publicIdentity: { publicKeyZ32: "fake", publicKeyDisplay: "pubkyfake" } });
  }
}

class FakeHomegateInvites implements GoogleHomegateInviteRequester {
  calls: Array<{ googleIdToken: string }> = [];
  failure?: GoogleHomegateInviteRequesterErrorCode;

  constructor(private readonly onRequest?: () => void) {}

  async requestSignupInvitation(input: { googleIdToken: string }) {
    this.onRequest?.();
    this.calls.push(input);
    if (this.failure) return Result.err({ code: this.failure });
    return Result.ok({ signupCode: "homegate-signup-code", homeserverPubky: "homegate-homeserver" });
  }
}

function activationDependencies(keys: FakePubkyIdentityKeys) {
  const signup = new FakePubkySignup();
  signup.session.publicIdentity = keys.nextPublicIdentity;
  return {
    homegate: new FakeHomegateInvites(),
    signup,
    discovery: new FakePubkyDiscovery(),
  };
}
