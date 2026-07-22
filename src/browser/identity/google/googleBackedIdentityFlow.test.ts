import { describe, expect, it } from "vitest";
import { Result } from "better-result";

import { FakePubkyIdentityKeys } from "../../../../test-utils/fakes/fakePubkyIdentityKeys";
import type { LocalIdentityRepository, LocalIdentityRepositoryResult } from "../localIdentityRepository";
import type { PubkyIdentityKey } from "../../../features/identity/pubkyIdentity";
import type { PassportFileCrypto, PassportFileStore } from "../../passport-file/passportFilePorts";
import type { PassportFileEnvelopeV1 } from "../../../features/passport-file/passportFile";
import { GoogleBackedIdentityFlow } from "./googleBackedIdentityFlow";

const envelope: PassportFileEnvelopeV1 = {
  v: 1,
  iv: "a".repeat(16),
  ct: "b".repeat(64),
  url: "https://passport.pubky.app",
};

describe("GoogleBackedIdentityFlow", () => {
  it("restores a Drive identity and saves it locally", async () => {
    const keys = new FakePubkyIdentityKeys();
    const local = new FakeLocalIdentities();
    const files = new FakePassportFiles({ status: "found", envelope });
    const crypto = new FakePassportCrypto();
    const flow = createFlow({ keys, local, files, crypto });

    const result = await flow.establish({ googleIdToken: "id-token", driveAccessToken: "drive-token" });

    expect(Result.isError(result)).toBe(false);
    expect(keys.createCalls).toBe(0);
    expect(keys.restoreCalls).toHaveLength(1);
    expect(local.savedHandles).toHaveLength(1);
    expect(crypto.decryptedBytes.every((byte) => byte === 0)).toBe(true);
  });

  it("creates, encrypts, writes, and then saves a missing Drive identity", async () => {
    const keys = new FakePubkyIdentityKeys();
    const local = new FakeLocalIdentities();
    const files = new FakePassportFiles({ status: "missing" });
    const crypto = new FakePassportCrypto();
    const flow = createFlow({ keys, local, files, crypto });

    const result = await flow.establish({ googleIdToken: "id-token", driveAccessToken: "drive-token" });

    expect(Result.isError(result)).toBe(false);
    expect(keys.createCalls).toBe(1);
    expect(files.written).toEqual([envelope]);
    expect(local.savedHandles).toHaveLength(1);
    expect(crypto.encryptedBytes.every((byte) => byte === 0)).toBe(true);
  });

  it("deletes a Drive identity only when it matches the selected local identity", async () => {
    const keys = new FakePubkyIdentityKeys();
    const local = new FakeLocalIdentities();
    const files = new FakePassportFiles({ status: "found", envelope });
    const crypto = new FakePassportCrypto();
    const flow = createFlow({ keys, local, files, crypto });

    const deleted = await flow.deleteIdentity(
      { googleIdToken: "id-token", driveAccessToken: "drive-token" },
      keys.nextPublicIdentity.publicKeyZ32,
    );

    expect(Result.isError(deleted)).toBe(false);
    expect(files.deleteCalls).toBe(1);
    expect(keys.disposedKeys).toHaveLength(1);
    expect(crypto.decryptedBytes.every((byte) => byte === 0)).toBe(true);
  });

  it("does not delete a Drive identity that differs from the selected identity", async () => {
    const keys = new FakePubkyIdentityKeys();
    const files = new FakePassportFiles({ status: "found", envelope });
    const flow = createFlow({ keys, local: new FakeLocalIdentities(), files, crypto: new FakePassportCrypto() });

    const deleted = await flow.deleteIdentity(
      { googleIdToken: "id-token", driveAccessToken: "drive-token" },
      "different-local-identity",
    );

    expect(Result.isError(deleted)).toBe(true);
    if (Result.isError(deleted)) expect(deleted.error).toEqual({ code: "identity_mismatch" });
    expect(files.deleteCalls).toBe(0);
  });

});

function createFlow(input: {
  keys: FakePubkyIdentityKeys;
  local: FakeLocalIdentities;
  files: FakePassportFiles;
  crypto: FakePassportCrypto;
}): GoogleBackedIdentityFlow {
  return new GoogleBackedIdentityFlow({
    wrappingKeys: { async requestWrappingKey() { return Result.ok("w".repeat(43)); } },
    passportFilesForAccessToken(accessToken) {
      expect(accessToken).toBe("drive-token");
      return input.files;
    },
    crypto: input.crypto,
    identityKeys: input.keys,
    localIdentities: input.local,
    passportUrl: "https://passport.pubky.app",
  });
}

class FakePassportFiles implements PassportFileStore {
  written: PassportFileEnvelopeV1[] = [];
  deleteCalls = 0;
  constructor(private readonly readResult: { status: "found"; envelope: PassportFileEnvelopeV1 } | { status: "missing" } | { code: "invalid_file" }) {}
  async readPassportFile() {
    return "code" in this.readResult ? Result.err(this.readResult) : Result.ok(this.readResult);
  }
  async writePassportFile(input: { envelope: PassportFileEnvelopeV1 }) {
    this.written.push(input.envelope);
    return Result.ok();
  }
  async deletePassportFile() {
    this.deleteCalls += 1;
    return Result.ok();
  }
}

class FakePassportCrypto implements PassportFileCrypto {
  decryptedBytes: Uint8Array<ArrayBuffer> = new Uint8Array(32).fill(7);
  encryptedBytes: Uint8Array<ArrayBufferLike> = new Uint8Array(32);
  async decryptSecretKeyBytes() { return Result.ok(this.decryptedBytes); }
  async encryptSecretKeyBytes(input: { secretKeyBytes: Uint8Array }) {
    this.encryptedBytes = input.secretKeyBytes;
    return Result.ok(envelope);
  }
}

class FakeLocalIdentities implements LocalIdentityRepository {
  savedHandles: unknown[] = [];
  list() { return Result.ok({ activeIdentityId: null, identities: [] }); }
  async saveIdentity(input: Parameters<LocalIdentityRepository["saveIdentity"]>[0]) {
    this.savedHandles.push(input.keyHandle);
    return Result.ok({ id: "fake", publicIdentity: { publicKeyZ32: "fake", publicKeyDisplay: "pubkyfake" } });
  }
  select() { return Result.ok(); }
  clear() { return Result.ok(); }
  async restoreActiveIdentity(): Promise<LocalIdentityRepositoryResult<PubkyIdentityKey>> {
    return Result.err({ code: "no_active_identity" });
  }
}
