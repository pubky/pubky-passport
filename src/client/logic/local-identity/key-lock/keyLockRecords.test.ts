import { afterEach, describe, expect, it, vi } from "vitest";

import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";
import { isGoogleAccountProfile } from "@/libs/googleAccountProfile";
import { encodeBase64Url } from "@/libs/encoding/base64Url";
import { KEY_LOCK_STORAGE, KEY_LOCK_WEB_LOCK } from "./keyLockFormat";
import {
  parseKeyLockVault,
  parseLockedIdentity,
  parseLockedDraft,
  serializeKeyLockVault,
  serializeLockedIdentity,
  serializeLockedDraft,
  lockedRecordStatus,
  googleAccountForLockedStorage,
  type KeyLockVaultRecord,
  type LockedIdentityRecord,
  type LockedDraftRecord,
} from "./keyLockRecords";

const b64 = (length: number) => encodeBase64Url(new Uint8Array(length));
const publicKeyZ32 = "y".repeat(52);
const seal = { vaultId: b64(16), iv: b64(12), ct: b64(48) };

function vault(): KeyLockVaultRecord {
  return {
    v: 2,
    state: "on",
    vaultId: b64(16),
    origin: "https://passport.example",
    rpId: "passport.example",
    createdAt: "2026-09-29T00:00:00.000Z",
    slots: [
      {
        slotId: b64(16),
        kind: "passkey",
        credentialId: b64(32),
        prfInput: b64(32),
        label: "Passport key lock · Browser · AAAA",
        transports: ["internal"],
        attachment: "platform",
        backupEligible: true,
        backupState: true,
        clientEngine: "webkit",
        wrappedDek: { iv: b64(12), ct: b64(48) },
      },
    ],
  };
}

function identity(): LockedIdentityRecord {
  return { v: 2, publicKeyZ32, lockedFrom: "first_write", seal: { ...seal } };
}

function draft(): LockedDraftRecord {
  return { ...identity(), homeserverPubky: publicKeyZ32, signupToken: "invite", step: "password" };
}

function changed(value: object, path: string, replacement: unknown, remove = false): string {
  const copy = structuredClone(value);
  const parts = path.split(".");
  const field = parts.pop()!;
  let record = copy as Record<string, unknown>;
  for (const part of parts) record = record[part] as Record<string, unknown>;
  if (remove) delete record[field];
  else record[field] = replacement;
  return JSON.stringify(copy);
}

afterEach(() => vi.restoreAllMocks());

describe("v2 key-lock records", () => {
  it("uses only the designated v2 keys and shared Web Lock name", () => {
    expect(KEY_LOCK_STORAGE).toEqual({
      vault: "pubky-passport/key-lock/v2/vault",
      retiredPrefix: "pubky-passport/key-lock/v2/retired/",
      identityPrefix: "pubky-passport/local-identities/v2/identity/",
      draft: "pubky-passport/local-account-draft/v2",
    });
    expect(KEY_LOCK_WEB_LOCK).toBe("pubky-passport/key-lock");
  });

  it.each(["enrolling", "on", "disabling"] as const)("round-trips a %s vault", (state) => {
    const value = { ...vault(), state };
    expect(expectResultOk(parseKeyLockVault(expectResultOk(serializeKeyLockVault(value))))).toEqual(
      value,
    );
  });

  it("round-trips complete identity and draft metadata without adding plaintext", () => {
    const value: LockedIdentityRecord = {
      ...identity(),
      lockedFrom: "migration",
      homeserverPubky: publicKeyZ32,
      profileSetupRequired: true,
      googleAccount: {
        googleSubject: "123",
        email: "test@example.com",
        name: "Zoë",
        pictureUrl: null,
      },
    };
    const identityJson = expectResultOk(serializeLockedIdentity(value));
    expect(expectResultOk(parseLockedIdentity(identityJson))).toEqual(value);
    const unfinished: LockedDraftRecord = {
      ...draft(),
      step: "confirm",
      registrationStarted: true,
    };
    expect(
      expectResultOk(parseLockedDraft(expectResultOk(serializeLockedDraft(unfinished)))),
    ).toEqual(unfinished);
  });

  it.each([
    "v",
    "state",
    "vaultId",
    "origin",
    "rpId",
    "createdAt",
    "slots",
    "slots.0.slotId",
    "slots.0.kind",
    "slots.0.credentialId",
    "slots.0.prfInput",
    "slots.0.label",
    "slots.0.transports",
    "slots.0.attachment",
    "slots.0.backupEligible",
    "slots.0.backupState",
    "slots.0.clientEngine",
    "slots.0.wrappedDek",
    "slots.0.wrappedDek.iv",
    "slots.0.wrappedDek.ct",
  ])("rejects missing vault field %s as damaged", (path) => {
    expectResultError(parseKeyLockVault(changed(vault(), path, undefined, true)), {
      code: "damaged",
    });
  });

  it.each([
    ["extra", true],
    ["v", "2"],
    ["state", 1],
    ["vaultId", b64(15)],
    ["vaultId", b64(17)],
    ["origin", "passport.example"],
    ["origin", "https://"],
    ["origin", 5],
    ["origin", "https://passport.example/"],
    ["origin", "https://user:pass@passport.example"],
    ["origin", "https://passport.example?query"],
    ["origin", "https://passport.example#fragment"],
    ["origin", "http://passport.example"],
    ["rpId", "example"],
    ["createdAt", "2026-09-29T00:00:00+00:00"],
    ["createdAt", "2026-02-30T00:00:00.000Z"],
    ["slots", null],
    ["slots.0.extra", true],
    ["slots.0.kind", false],
    ["slots.0.slotId", b64(15)],
    ["slots.0.prfInput", b64(31)],
    ["slots.0.prfInput", `${"A".repeat(42)}B`],
    ["slots.0.label", ""],
    ["slots.0.label", "é".repeat(48) + "a"],
    ["slots.0.label", "é".repeat(49)],
    ["slots.0.transports", ["unknown"]],
    ["slots.0.attachment", "unknown-provider"],
    ["slots.0.backupEligible", 1],
    ["slots.0.backupState", "true"],
    ["slots.0.clientEngine", "future"],
    ["slots.0.wrappedDek.extra", 1],
    ["slots.0.wrappedDek.iv", b64(11)],
    ["slots.0.wrappedDek.ct", b64(47)],
    ["pendingScrub", [{ kind: "identity", publicKeyZ32, digest: b64(31) }]],
    ["pendingScrub", [{ kind: "future", publicKeyZ32, digest: b64(32) }]],
    ["pendingScrub", [{ kind: "draft", publicKeyZ32: "wrong", digest: b64(32) }]],
    ["pendingScrub", [{ kind: "draft", publicKeyZ32, digest: b64(32), extra: 1 }]],
  ])("rejects invalid vault field %s as damaged", (path, value) => {
    expectResultError(parseKeyLockVault(changed(vault(), path as string, value)), {
      code: "damaged",
    });
  });

  it.each([
    ["v", 3],
    ["v", 1],
    ["state", "future"],
    ["slots", []],
    ["slots", [vault().slots[0], vault().slots[0]]],
    ["slots.0.kind", "password"],
  ])("preserves unknown vault discriminator %s as newer", (path, value) => {
    expectResultError(parseKeyLockVault(changed(vault(), path as string, value)), {
      code: "newer",
    });
  });

  it.each([15, 16, 1023, 1024])(
    "checks a %i-byte credential ID after canonical decoding",
    (length) => {
      const result = parseKeyLockVault(changed(vault(), "slots.0.credentialId", b64(length)));
      if (length === 16 || length === 1023) expectResultOk(result);
      else expectResultError(result, { code: "damaged" });
    },
  );

  it.each([`${b64(16)}=`, `${"A".repeat(21)}B`, "+".repeat(22), "/".repeat(22)])(
    "rejects noncanonical credential IDs",
    (value) => {
      expectResultError(parseKeyLockVault(changed(vault(), "slots.0.credentialId", value)), {
        code: "damaged",
      });
    },
  );

  it("fits the maximal vault in 32 KiB and refuses 201 scrub entries", () => {
    const value = vault();
    value.rpId = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
    expect(value.rpId).toHaveLength(253);
    value.origin = `https://${value.rpId}`;
    value.slots[0].credentialId = b64(1023);
    expect(value.slots[0].credentialId).toHaveLength(1364);
    value.slots[0].label = "é".repeat(48);
    value.slots[0].transports = ["internal", "hybrid", "usb", "nfc", "ble", "smart-card"];
    value.pendingScrub = Array.from({ length: 200 }, (_, index) => ({
      kind: "identity",
      publicKeyZ32: `${index.toString(2).padStart(8, "0").replaceAll("0", "y").replaceAll("1", "b")}${"y".repeat(44)}`,
      digest: b64(32),
    }));
    expect(new Set(value.pendingScrub.map((entry) => entry.publicKeyZ32)).size).toBe(200);
    const raw = expectResultOk(serializeKeyLockVault(value));
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(32 * 1024);
    expect(expectResultOk(parseKeyLockVault(raw))).toEqual(value);
    value.pendingScrub.push({ kind: "draft", publicKeyZ32, digest: b64(32) });
    expectResultError(serializeKeyLockVault(value), { code: "too_many_keys" });
    expectResultError(parseKeyLockVault(JSON.stringify(value)), { code: "damaged" });
  });

  it("accepts the explicit localhost test origin and canonical HTTPS ports with exact RP host", () => {
    for (const origin of ["http://localhost:3300", "https://passport.example:444"]) {
      const value = { ...vault(), origin, rpId: new URL(origin).hostname };
      expectResultOk(parseKeyLockVault(JSON.stringify(value)));
    }
  });

  it.each(["v", "publicKeyZ32", "lockedFrom", "seal", "seal.vaultId", "seal.iv", "seal.ct"])(
    "requires identity and draft field %s",
    (path) => {
      expectResultError(parseLockedIdentity(changed(identity(), path, undefined, true)), {
        code: path === "v" ? "unknown_version" : "damaged",
      });
      expectResultError(parseLockedDraft(changed(draft(), path, undefined, true)), {
        code: path === "v" ? "unknown_version" : "damaged",
      });
    },
  );

  it.each([
    ["v", "2"],
    ["publicKeyZ32", "bad"],
    ["lockedFrom", "later"],
    ["seal.vaultId", b64(15)],
    ["seal.iv", b64(13)],
    ["seal.ct", b64(49)],
    ["seal.extra", true],
    ["secretKey", "synthetic"],
  ])("rejects invalid identity and draft field %s", (path, value) => {
    expectResultError(parseLockedIdentity(changed(identity(), path as string, value)), {
      code: path === "v" ? "unknown_version" : "damaged",
    });
    expectResultError(parseLockedDraft(changed(draft(), path as string, value)), {
      code: path === "v" ? "unknown_version" : "damaged",
    });
  });

  it.each([
    [
      "googleAccount",
      {
        googleSubject: "123",
        email: "test@example.com",
        name: "Test",
        pictureUrl: "https://attacker.example/avatar",
      },
    ],
    ["googleAccount", null],
    ["profileSetupRequired", false],
    ["homeserverPubky", "wrong"],
    ["keySource", "ring"],
  ])("keeps identity metadata validation for %s", (path, value) => {
    expectResultError(parseLockedIdentity(changed(identity(), path as string, value)), {
      code: "damaged",
    });
  });

  it.each(["homeserverPubky", "signupToken", "step"])("requires draft metadata %s", (path) => {
    expectResultError(parseLockedDraft(changed(draft(), path, undefined, true)), {
      code: "damaged",
    });
  });

  it.each([
    ["homeserverPubky", "wrong"],
    ["signupToken", " "],
    ["signupToken", "a".repeat(1025)],
    ["step", "future"],
    ["registrationStarted", false],
    ["googleAccount", {}],
  ])("rejects invalid draft metadata %s", (path, value) => {
    expectResultError(parseLockedDraft(changed(draft(), path as string, value)), {
      code: "damaged",
    });
  });

  it("classifies unknown identity/draft versions as newer", () => {
    expectResultError(parseLockedIdentity(changed(identity(), "v", 3)), { code: "newer" });
    expectResultError(parseLockedDraft(changed(draft(), "v", 3)), { code: "newer" });
  });

  it("enforces UTF-8 record caps before JSON parsing and never retains parser errors", () => {
    const parse = vi.spyOn(JSON, "parse");
    expectResultError(parseKeyLockVault(" ".repeat(32769)), { code: "damaged" });
    expectResultError(parseLockedIdentity("é".repeat(2049)), { code: "unknown_version" });
    expectResultError(parseLockedDraft(" ".repeat(4097)), { code: "unknown_version" });
    expect(parse).not.toHaveBeenCalled();
    for (const raw of ["null", "[]", "{invalid synthetic data", "42"]) {
      expectResultError(parseKeyLockVault(raw), { code: "damaged" });
    }
    const oversized = {
      ...identity(),
      googleAccount: {
        googleSubject: "123",
        email: "test@example.com",
        name: "Test",
        pictureUrl: `data:image/png;base64,${"A".repeat(4100)}`,
      },
    };
    expectResultError(serializeLockedIdentity(oversized), { code: "invalid_record" });
    expectResultError(
      serializeLockedDraft({ ...draft(), step: "future" } as unknown as LockedDraftRecord),
      { code: "invalid_record" },
    );
  });

  it.each(["3", 2.5, null, true, undefined])("preserves unknown identity/draft version %s", (v) => {
    for (const parse of [parseLockedIdentity, parseLockedDraft])
      expectResultError<unknown, unknown>(parse(JSON.stringify({ ...draft(), v })), {
        code: "unknown_version",
      });
  });

  it.each(["null", "[]", "{not JSON", "42", "{}"])(
    "does not imply a known version for %s",
    (raw) => {
      expectResultError(parseLockedIdentity(raw), { code: "unknown_version" });
      expectResultError(parseLockedDraft(raw), { code: "unknown_version" });
      expectResultError(parseKeyLockVault(raw), { code: "damaged" });
    },
  );

  it.each([-1, 0, 1, 3])("preserves integer version %i as newer", (v) => {
    expectResultError(parseLockedIdentity(JSON.stringify({ ...identity(), v })), { code: "newer" });
    expectResultError(parseLockedDraft(JSON.stringify({ ...draft(), v })), { code: "newer" });
    expectResultError(parseKeyLockVault(JSON.stringify({ ...vault(), v })), { code: "newer" });
  });

  it("never decodes oversized future-version records to guess their version", () => {
    const rawRecord = JSON.stringify({ v: 3, padding: "a".repeat(4096) });
    const rawVault = JSON.stringify({ v: 3, padding: "a".repeat(32768) });
    const parse = vi.spyOn(JSON, "parse");
    expectResultError(parseLockedIdentity(rawRecord), { code: "unknown_version" });
    expectResultError(parseLockedDraft(rawRecord), { code: "unknown_version" });
    expectResultError(parseKeyLockVault(rawVault), { code: "damaged" });
    expect(parse).not.toHaveBeenCalled();
  });

  it("refuses a 254-character RP host even with a matching canonical origin", () => {
    const rpId = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`;
    expect(rpId).toHaveLength(254);
    expectResultError(
      parseKeyLockVault(JSON.stringify({ ...vault(), rpId, origin: `https://${rpId}` })),
      { code: "damaged" },
    );
  });

  it("rejects plaintext fields on identity and draft serialization", () => {
    expectResultError(serializeLockedIdentity({ ...identity(), secretKey: "synthetic" } as never), {
      code: "invalid_record",
    });
    expectResultError(
      serializeLockedDraft({ ...draft(), seal: { ...seal, secretKey: "synthetic" } } as never),
      { code: "invalid_record" },
    );
  });

  it("converts an 8 KB cached avatar for locked metadata without changing the source", () => {
    const source = {
      googleSubject: "123",
      email: "test@example.com",
      name: "Test",
      pictureUrl: `data:image/png;base64,${"A".repeat(8192)}`,
    };
    expect(isGoogleAccountProfile(source)).toBe(true);
    expectResultError(serializeLockedIdentity({ ...identity(), googleAccount: source }), {
      code: "invalid_record",
    });
    const normalized = googleAccountForLockedStorage(source);
    expect(normalized).toEqual({ ...source, pictureUrl: null });
    expect(source.pictureUrl).toHaveLength(8214);
    const value = { ...identity(), googleAccount: normalized };
    expect(
      expectResultOk(parseLockedIdentity(expectResultOk(serializeLockedIdentity(value)))),
    ).toEqual(value);
    const smallData = { ...source, pictureUrl: "data:image/png;base64,AAAA" };
    expectResultError(
      parseLockedIdentity(JSON.stringify({ ...identity(), googleAccount: smallData })),
      { code: "damaged" },
    );
  });

  it("round-trips ASCII v1 metadata maxima and names the oversized CJK refusal", () => {
    const value: LockedIdentityRecord = {
      ...identity(),
      lockedFrom: "migration",
      homeserverPubky: publicKeyZ32,
      profileSetupRequired: true,
      googleAccount: {
        googleSubject: "s".repeat(255),
        email: "e".repeat(320),
        name: "n".repeat(512),
        pictureUrl: "https://lh3.googleusercontent.com/".padEnd(2048, "a"),
      },
    };
    expect(isGoogleAccountProfile(value.googleAccount)).toBe(true);
    expect(googleAccountForLockedStorage(value.googleAccount!)).toEqual(value.googleAccount);
    const raw = expectResultOk(serializeLockedIdentity(value));
    expect(new TextEncoder().encode(raw).byteLength).toBe(3552);
    expect(expectResultOk(parseLockedIdentity(raw))).toEqual(value);
    const oversized = {
      ...value,
      googleAccount: { ...value.googleAccount!, email: "e".repeat(305), name: "界".repeat(512) },
    };
    expect(isGoogleAccountProfile(oversized.googleAccount)).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBe(4561);
    expectResultError(serializeLockedIdentity(oversized), { code: "record_too_large" });
  });

  it("derives lock labels only from the current vault and the record's history", () => {
    expect(lockedRecordStatus(identity(), seal.vaultId)).toBe("locked");
    expect(lockedRecordStatus({ ...identity(), lockedFrom: "migration" }, seal.vaultId)).toBe(
      "locked_from_now_on",
    );
    expect(lockedRecordStatus(draft(), null)).toBe("other_passkey");
    expect(lockedRecordStatus(identity(), encodeBase64Url(new Uint8Array(16).fill(1)))).toBe(
      "other_passkey",
    );
  });

  it("returns a code without retaining a serialization exception", () => {
    vi.spyOn(JSON, "stringify").mockImplementationOnce(() => {
      throw new Error("synthetic detail");
    });
    expectResultError(serializeLockedIdentity(identity()), { code: "invalid_record" });
  });

  it("contains invalid vault serialization inputs", () => {
    expectResultError(serializeKeyLockVault(null as never), { code: "invalid_record" });
  });

  it("clears temporary UTF-8 copies used to check stored-record byte limits", () => {
    const encode = TextEncoder.prototype.encode;
    const copies: Uint8Array[] = [];
    vi.spyOn(TextEncoder.prototype, "encode").mockImplementation(function (
      this: TextEncoder,
      input,
    ) {
      const bytes = encode.call(this, input);
      copies.push(bytes);
      return bytes;
    });
    expectResultOk(parseKeyLockVault(JSON.stringify(vault())));
    expect(copies.length).toBeGreaterThan(0);
    expect(copies.every((copy) => copy.every((byte) => byte === 0))).toBe(true);
  });
});
