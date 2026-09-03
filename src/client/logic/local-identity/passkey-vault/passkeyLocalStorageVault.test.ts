import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../../../test-utils/MemoryStorage";
import { expectResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import { encodeBase64Url } from "../../../../libs/encoding/base64Url";
import { PUBKY_SECRET_KEY_FORMAT } from "../../pubky/pubkyIdentityKey";
import type { PasskeyPrfKeySource, PasskeyPrfResult } from "./BrowserPasskeyPrfKeySource";
import {
  PasskeyLocalStorageVault,
  VIBES_PASSKEY_VAULT_STORAGE_ROOT,
} from "./PasskeyLocalStorageVault";

const ORIGIN = "https://passport.test";
const FIRST_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECOND_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const CREDENTIAL_ID = encodeBase64Url(new Uint8Array(32).fill(3));
const PRF_OUTPUT = new Uint8Array(32).fill(7);
const CONFIGURATION_KEY = `${VIBES_PASSKEY_VAULT_STORAGE_ROOT}/configuration`;
const IDENTITY_PREFIX = `${VIBES_PASSKEY_VAULT_STORAGE_ROOT}/identity/`;

let storage: MemoryStorage;
let keySource: ReturnType<typeof fixedKeySource>;
let vault: PasskeyLocalStorageVault;

beforeEach(() => {
  storage = new MemoryStorage();
  keySource = fixedKeySource(PRF_OUTPUT);
  vault = new PasskeyLocalStorageVault(storage, crypto, keySource, ORIGIN);
});

describe("PasskeyLocalStorageVault", () => {
  it("stores only an encrypted envelope and requires unlock after locking", async () => {
    const secret = secretKey(11);
    const encodedPlaintext = encodeBase64Url(secret.bytes);

    expectResultOk(await vault.enroll());
    expectResultOk(await vault.saveSecret(FIRST_KEY, secret));

    const configuration = storage.getItem(CONFIGURATION_KEY);
    const storedSecret = storage.getItem(`${IDENTITY_PREFIX}${FIRST_KEY}`);
    expect(configuration).toContain(CREDENTIAL_ID);
    expect(configuration).not.toContain(encodedPlaintext);
    expect(storedSecret).not.toContain(encodedPlaintext);
    expect(storedSecret).not.toContain("secretKey");

    vault.lock();
    expect(vault.isUnlocked).toBe(false);
    expectResultError(await vault.readSecret(FIRST_KEY), { code: "locked" });

    expectResultOk(await vault.unlock());
    const opened = expectResultOk(await vault.readSecret(FIRST_KEY));
    expect(opened).toEqual(secret);
    expect(keySource.evaluate).toHaveBeenCalledOnce();
    opened.bytes.fill(0);
  });

  it("uses a fresh IV when replacing the same secret", async () => {
    expectResultOk(await vault.enroll());
    expectResultOk(await vault.saveSecret(FIRST_KEY, secretKey(4)));
    const firstEnvelope = storage.getItem(`${IDENTITY_PREFIX}${FIRST_KEY}`);

    expectResultOk(await vault.saveSecret(FIRST_KEY, secretKey(4)));
    const secondEnvelope = storage.getItem(`${IDENTITY_PREFIX}${FIRST_KEY}`);

    expect(secondEnvelope).not.toBe(firstEnvelope);
  });

  it("does not unlock with a different credential PRF output", async () => {
    expectResultOk(await vault.enroll());
    expectResultOk(await vault.saveSecret(FIRST_KEY, secretKey(2)));
    vault.lock();
    keySource.evaluate.mockResolvedValue(Result.ok(new Uint8Array(32).fill(8)));

    const result = await vault.unlock();

    expect(Result.isError(result) && result.error.code).toBe("unlock_failed");
    expect(vault.isUnlocked).toBe(false);
  });

  it("does not complete an unlock that was superseded by lock", async () => {
    expectResultOk(await vault.enroll());
    vault.lock();
    const evaluation = Promise.withResolvers<PasskeyPrfResult<Uint8Array>>();
    keySource.evaluate.mockReturnValue(evaluation.promise);

    const unlocking = vault.unlock();
    vault.lock();
    evaluation.resolve(Result.ok(Uint8Array.from(PRF_OUTPUT)));

    expectResultError(await unlocking, { code: "locked" });
    expect(vault.isUnlocked).toBe(false);
  });

  it("authenticates the identity binding as additional data", async () => {
    expectResultOk(await vault.enroll());
    expectResultOk(await vault.saveSecret(FIRST_KEY, secretKey(6)));
    const firstEnvelope = JSON.parse(
      storage.getItem(`${IDENTITY_PREFIX}${FIRST_KEY}`) ?? "null",
    ) as Record<string, unknown>;
    storage.setItem(
      `${IDENTITY_PREFIX}${SECOND_KEY}`,
      JSON.stringify({ ...firstEnvelope, publicKeyZ32: SECOND_KEY }),
    );

    const result = await vault.readSecret(SECOND_KEY);

    expect(Result.isError(result) && result.error.code).toBe("crypto_failed");
  });

  it("rejects malformed configuration and identity records", async () => {
    storage.setItem(CONFIGURATION_KEY, JSON.stringify({ v: 1 }));
    expectResultError(await vault.unlock(), { code: "invalid_store" });

    storage.clear();
    expectResultOk(await vault.enroll());
    storage.setItem(`${IDENTITY_PREFIX}${FIRST_KEY}`, "{not-json");
    expectResultError(await vault.readSecret(FIRST_KEY), { code: "invalid_store" });
  });

  it("rejects enrollment replacement and invalid secret input", async () => {
    expectResultOk(await vault.enroll());
    expectResultError(await vault.enroll(), { code: "already_enrolled" });
    expectResultError(
      await vault.saveSecret(FIRST_KEY, {
        bytes: new Uint8Array(31),
        format: PUBKY_SECRET_KEY_FORMAT,
      }),
      { code: "invalid_secret_key" },
    );
  });
});

function fixedKeySource(prfOutput: Uint8Array) {
  const createCredential: PasskeyPrfKeySource["createCredential"] = async () =>
    Result.ok({ credentialId: CREDENTIAL_ID, prfOutput: Uint8Array.from(prfOutput) });
  const evaluate: PasskeyPrfKeySource["evaluate"] = async () =>
    Result.ok(Uint8Array.from(prfOutput));
  return {
    createCredential: vi.fn(createCredential),
    evaluate: vi.fn(evaluate),
  } satisfies PasskeyPrfKeySource;
}

function secretKey(byte: number) {
  return { bytes: new Uint8Array(32).fill(byte), format: PUBKY_SECRET_KEY_FORMAT } as const;
}
