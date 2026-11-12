/** @vitest-environment jsdom */

import { Keypair } from "@synonymdev/pubky";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "@test-utils/MemoryStorage";
import { expectResultOk } from "@test-utils/resultAssertions";
import { LOGGER } from "@/libs/logger/logger";
import { PubkySdkAdapter } from "@/client/logic/pubky/PubkySdkAdapter";
import { LocalIdentityController } from "./LocalIdentityController";
import { LocalStorageIdentityRepository } from "./LocalStorageIdentityRepository";

const STORAGE_ROOT = "pubky-passport/local-identities/v1";
const PASSWORD = "test-password";
const PHRASE = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const PHRASE_PUBLIC_KEY = "a53kaica1hg81a3znuj6szbw469h84jpwsg8gifuxgmpujfx8k3y";
const HOMESERVER = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const GOOGLE = {
  googleSubject: "google-subject",
  email: "jane@example.com",
  name: "Jane",
  pictureUrl: null,
};

let storage: MemoryStorage;
let fileSecret: Uint8Array;
let filePublicKey: string;

function recoveryFile(password = PASSWORD): Uint8Array {
  const keypair = Keypair.fromSecret(fileSecret);
  try {
    return keypair.createRecoveryFile(password);
  } finally {
    keypair.free();
  }
}

function storedRecord(publicKeyZ32: string): Record<string, unknown> | null {
  const value = storage.getItem(`${STORAGE_ROOT}/identity/${publicKeyZ32}`);
  return value === null ? null : (JSON.parse(value) as Record<string, unknown>);
}

function network(
  resolve: () => Promise<unknown> = async () => Result.ok(HOMESERVER),
  signin: (publicKeyZ32: string) => Promise<unknown> = async (publicKeyZ32) =>
    Result.ok({ publicIdentity: { publicKeyZ32 } }),
) {
  const resolveHomeserver = vi
    .spyOn(PubkySdkAdapter.prototype, "resolveHomeserver")
    .mockImplementation(resolve as PubkySdkAdapter["resolveHomeserver"]);
  const signinSpy = vi
    .spyOn(PubkySdkAdapter.prototype, "signin")
    .mockImplementation(async function (this: PubkySdkAdapter, keyHandle) {
      const exported = this.exportSecretKey(keyHandle);
      if (Result.isError(exported)) throw new Error("key missing");
      const keypair = Keypair.fromSecret(exported.value.bytes);
      try {
        return (await signin(keypair.publicKey.z32())) as Awaited<
          ReturnType<PubkySdkAdapter["signin"]>
        >;
      } finally {
        keypair.free();
        exported.value.bytes.fill(0);
      }
    });
  return { resolveHomeserver, signin: signinSpy };
}

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
  // Nothing in an import may reach Passport's server (or anything else) except through the SDK.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("unexpected fetch");
    }),
  );
  const keypair = Keypair.random();
  fileSecret = keypair.secret();
  filePublicKey = keypair.publicKey.z32();
  keypair.free();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LocalIdentityController.importIdentity", () => {
  it("imports a recovery file as a browser-only identity after signing in", async () => {
    const { resolveHomeserver, signin } = network();
    const dispose = vi.spyOn(PubkySdkAdapter.prototype, "dispose");
    const bytes = recoveryFile();
    const recovered = vi.fn();

    const imported = expectResultOk(
      await new LocalIdentityController().importIdentity(
        { kind: "recovery-file", bytes, password: PASSWORD },
        recovered,
      ),
    );

    expect(imported).toEqual({
      publicIdentity: { publicKeyZ32: filePublicKey },
      alreadyStored: false,
    });
    expect(recovered).toHaveBeenCalledWith({ publicKeyZ32: filePublicKey });
    expect(resolveHomeserver).toHaveBeenCalledWith(filePublicKey);
    expect(signin).toHaveBeenCalledWith(expect.anything(), "normal");
    // Stored like a detached identity: no Google or Apple account.
    expect(Object.keys(storedRecord(filePublicKey) ?? {}).sort()).toEqual([
      "publicKeyZ32",
      "secretKey",
      "v",
    ]);
    expect(storage.getItem(`${STORAGE_ROOT}/active`)).toBe(filePublicKey);
    const read = expectResultOk(new LocalStorageIdentityRepository().read(filePublicKey));
    expect(read.secretKey.bytes).toEqual(fileSecret);
    expect(bytes).toEqual(new Uint8Array(bytes.length));
    expect(dispose).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("imports a recovery phrase with the pubky.app derivation and never logs the words", async () => {
    network();
    const logged: string[] = [];
    for (const level of ["debug", "info", "warn", "error"] as const) {
      vi.spyOn(LOGGER, level).mockImplementation((event, fields) => {
        logged.push(JSON.stringify([event, fields]));
      });
    }

    const imported = expectResultOk(
      await new LocalIdentityController().importIdentity({
        kind: "recovery-phrase",
        words: PHRASE.split(" "),
      }),
    );

    expect(imported.publicIdentity.publicKeyZ32).toBe(PHRASE_PUBLIC_KEY);
    expect(storedRecord(PHRASE_PUBLIC_KEY)).not.toBeNull();
    for (const word of PHRASE.split(" ")) expect(logged.join("\n")).not.toContain(word);
  });

  it.each([
    ["a wrong password", () => recoveryFile("another-password"), "recovery_file_undecryptable"],
    ["an empty password", () => recoveryFile(), "recovery_file_undecryptable"],
    [
      "a file without the recovery header",
      () => new Uint8Array(91).fill(1),
      "invalid_recovery_file",
    ],
    [
      "an oversized file",
      () => {
        const big = new Uint8Array(2048);
        big.set(new TextEncoder().encode("pubky.org/recovery\n"));
        return big;
      },
      "invalid_recovery_file",
    ],
  ] as const)("rejects %s before any network call", async (label, file, code) => {
    const { resolveHomeserver, signin } = network();
    const bytes = file();
    const result = await new LocalIdentityController().importIdentity({
      kind: "recovery-file",
      bytes,
      password: label === "an empty password" ? "" : PASSWORD,
    });

    expect(Result.isError(result) && result.error.code).toBe(code);
    expect(resolveHomeserver).not.toHaveBeenCalled();
    expect(signin).not.toHaveBeenCalled();
    expect(storage.length).toBe(0);
    expect(bytes).toEqual(new Uint8Array(bytes.length));
  });

  it("rejects an invalid phrase without saying which word", async () => {
    const { resolveHomeserver } = network();
    const result = await new LocalIdentityController().importIdentity({
      kind: "recovery-phrase",
      words: Array<string>(12).fill("zoo"),
    });

    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_recovery_phrase" });
    expect(resolveHomeserver).not.toHaveBeenCalled();
  });

  it.each([
    ["no homeserver record", async () => Result.ok(null), "homeserver_not_found"],
    [
      "an unreachable relay",
      async () => Result.err({ code: "resolution_failed" as const }),
      "homeserver_unreachable",
    ],
  ] as const)("saves nothing when the key has %s", async (_label, resolve, code) => {
    const { signin } = network(resolve);
    const result = await new LocalIdentityController().importIdentity({
      kind: "recovery-file",
      bytes: recoveryFile(),
      password: PASSWORD,
    });

    expect(Result.isError(result) && result.error.code).toBe(code);
    expect(signin).not.toHaveBeenCalled();
    expect(storage.length).toBe(0);
  });

  it("saves nothing when the homeserver sign-in fails", async () => {
    network(undefined, async () => Result.err({ code: "signin_failed" as const }));
    const result = await new LocalIdentityController().importIdentity({
      kind: "recovery-file",
      bytes: recoveryFile(),
      password: PASSWORD,
    });

    expect(Result.isError(result) && result.error.code).toBe("signin_failed");
    expect(storage.length).toBe(0);
  });

  it("selects an identity this browser already holds and keeps its Google link", async () => {
    const repository = new LocalStorageIdentityRepository();
    expectResultOk(
      repository.save(
        { publicIdentity: { publicKeyZ32: filePublicKey }, googleAccount: GOOGLE },
        { bytes: fileSecret.slice(), format: "pubky-secret-key" },
      ),
    );
    const other = Keypair.random();
    expectResultOk(
      repository.save(
        { publicIdentity: { publicKeyZ32: other.publicKey.z32() } },
        { bytes: other.secret(), format: "pubky-secret-key" },
      ),
    );
    other.free();
    const before = storage.getItem(`${STORAGE_ROOT}/identity/${filePublicKey}`);
    const { resolveHomeserver, signin } = network();

    const imported = expectResultOk(
      await new LocalIdentityController().importIdentity({
        kind: "recovery-file",
        bytes: recoveryFile(),
        password: PASSWORD,
      }),
    );

    expect(imported.alreadyStored).toBe(true);
    expect(storage.getItem(`${STORAGE_ROOT}/identity/${filePublicKey}`)).toBe(before);
    expect(storage.getItem(`${STORAGE_ROOT}/active`)).toBe(filePublicKey);
    expect(expectResultOk(repository.list()).identities).toHaveLength(2);
    expect(resolveHomeserver).not.toHaveBeenCalled();
    expect(signin).not.toHaveBeenCalled();
  });

  it("keeps a record another tab stored during sign-in", async () => {
    network(undefined, async (publicKeyZ32) => {
      expectResultOk(
        new LocalStorageIdentityRepository().save(
          { publicIdentity: { publicKeyZ32 }, googleAccount: GOOGLE },
          { bytes: fileSecret.slice(), format: "pubky-secret-key" },
        ),
      );
      return Result.ok({ publicIdentity: { publicKeyZ32 } });
    });

    const imported = expectResultOk(
      await new LocalIdentityController().importIdentity({
        kind: "recovery-file",
        bytes: recoveryFile(),
        password: PASSWORD,
      }),
    );

    expect(imported.alreadyStored).toBe(true);
    expect(storedRecord(filePublicKey)?.googleAccount).toEqual(GOOGLE);
  });

  it("refuses a sign-in that reports another key", async () => {
    network(undefined, async () => Result.ok({ publicIdentity: { publicKeyZ32: HOMESERVER } }));
    const result = await new LocalIdentityController().importIdentity({
      kind: "recovery-file",
      bytes: recoveryFile(),
      password: PASSWORD,
    });

    expect(Result.isError(result) && result.error.code).toBe("signin_failed");
    expect(storage.length).toBe(0);
  });

  it("reports storage that cannot be read or written", async () => {
    network();
    const failing = new LocalIdentityController({
      ...new LocalStorageIdentityRepository(),
      list: () => Result.err({ code: "storage_unavailable" as const }),
      read: vi.fn(),
      remove: vi.fn(),
      saveIfAbsent: vi.fn(),
      select: vi.fn(),
      subscribe: vi.fn(),
    });
    const unreadable = await failing.importIdentity({
      kind: "recovery-file",
      bytes: recoveryFile(),
      password: PASSWORD,
    });
    expect(Result.isError(unreadable) && unreadable.error.code).toBe("storage_unavailable");

    const repository = new LocalStorageIdentityRepository();
    const save = vi.fn(() => Result.err({ code: "storage_unavailable" as const }));
    const unwritable = new LocalIdentityController({
      list: () => repository.list(),
      read: (publicKeyZ32) => repository.read(publicKeyZ32),
      remove: (publicKeyZ32) => repository.remove(publicKeyZ32),
      saveIfAbsent: save,
      select: (publicKeyZ32) => repository.select(publicKeyZ32),
      subscribe: (listener) => repository.subscribe(listener),
    });
    const result = await unwritable.importIdentity({
      kind: "recovery-file",
      bytes: recoveryFile(),
      password: PASSWORD,
    });
    expect(Result.isError(result) && result.error.code).toBe("storage_unavailable");
    // The exported key handed to storage is cleared afterwards.
    const handed = save.mock.calls[0] as unknown as [unknown, { bytes: Uint8Array }];
    expect(handed[1].bytes).toEqual(new Uint8Array(32));
  });

  it("maps a throwing homeserver lookup to a failed sign-in and saves nothing", async () => {
    network(async () => {
      throw new Error("boom");
    });
    const result = await new LocalIdentityController().importIdentity({
      kind: "recovery-file",
      bytes: recoveryFile(),
      password: PASSWORD,
    });

    expect(Result.isError(result) && result.error.code).toBe("signin_failed");
    expect(storage.length).toBe(0);
  });

  it("contains an unexpected exception", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    network();
    vi.spyOn(LocalStorageIdentityRepository.prototype, "saveIfAbsent").mockImplementation(() => {
      throw new Error("boom");
    });
    const result = await new LocalIdentityController().importIdentity({
      kind: "recovery-file",
      bytes: recoveryFile(),
      password: PASSWORD,
    });

    expect(Result.isError(result) && result.error.code).toBe("import_failed");
    expect(storage.length).toBe(0);
  });

  it("saves nothing when the sign-in succeeds only after the deadline", async () => {
    let finishSignin: () => void = () => undefined;
    network(undefined, async (publicKeyZ32) => {
      await new Promise<void>((resolve) => {
        finishSignin = resolve;
      });
      return Result.ok({ publicIdentity: { publicKeyZ32 } });
    });
    const dispose = vi.spyOn(PubkySdkAdapter.prototype, "dispose");

    const result = await new LocalIdentityController(undefined, {
      importNetworkTimeoutMs: 20,
    }).importIdentity({ kind: "recovery-file", bytes: recoveryFile(), password: PASSWORD });

    expect(Result.isError(result) && result.error.code).toBe("homeserver_unreachable");
    expect(dispose).not.toHaveBeenCalled();
    finishSignin();
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(storage.length).toBe(0);
  });

  it("gives up on a homeserver that never answers, then releases the SDK when it settles", async () => {
    let answer: (value: unknown) => void = () => undefined;
    network(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const dispose = vi.spyOn(PubkySdkAdapter.prototype, "dispose");

    const result = await new LocalIdentityController(undefined, {
      importNetworkTimeoutMs: 20,
    }).importIdentity({ kind: "recovery-file", bytes: recoveryFile(), password: PASSWORD });

    expect(Result.isError(result) && result.error.code).toBe("homeserver_unreachable");
    expect(storage.length).toBe(0);
    expect(dispose).not.toHaveBeenCalled();
    answer(Result.ok(null));
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(storage.length).toBe(0);
  });
});
