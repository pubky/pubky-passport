import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import { LOGGER } from "@/libs/logger/logger";
import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";
import type {
  CloudKitDatabase,
  CloudKitRecordsBatch,
  CloudKitResponse,
} from "@/client/logic/apple-identity/ICloudConnection";
import {
  serializePassportFileEnvelope,
  type PassportFileEnvelope,
} from "@/client/logic/passport-file/passportFileEnvelope";
import {
  appleSubjectHash,
  ICloudPassportFileStore,
  PASSPORT_FILE_RECORD_TYPE,
  passportFileRecordName,
} from "./ICloudPassportFileStore";

const SUBJECT = "001234.SECRET-APPLE-SUBJECT.1234";
const ENVELOPE = {
  v: 1,
  keyId: "2026-08",
  iv: "AAECAwQFBgcICQoL",
  ct: "YZy1I_a6WzFnql8rW2A94EJrgz38Sqd1LV_KjVe2Qd2n1mvFMXg9qzRHwJ_WQvrm",
  url: "https://passport.pubky.app",
} satisfies PassportFileEnvelope;
const SERIALIZED = serializePassportFileEnvelope(ENVELOPE) as string;
const ORIGIN = "https://passport.pubky.app";
const PASSPORT_FILE_RECORD_NAME = await passportFileRecordName(ORIGIN);

type Operation =
  | { type: "create"; record: Parameters<CloudKitRecordsBatch["create"]>[0] }
  | { type: "delete"; record: Parameters<CloudKitRecordsBatch["delete"]>[0] };

function fakeDatabase(options: {
  fetch?: () => Promise<CloudKitResponse>;
  commit?: () => Promise<CloudKitResponse>;
}) {
  const operations: Operation[] = [];
  const fetchRecords = vi.fn(async (names: string[]) => {
    expect(names).toEqual([PASSPORT_FILE_RECORD_NAME]);
    return options.fetch ? options.fetch() : { records: [] };
  });
  const commit = vi.fn(async () => (options.commit ? options.commit() : { records: [] }));
  const database: CloudKitDatabase = {
    fetchRecords,
    newRecordsBatch() {
      const batch: CloudKitRecordsBatch = {
        create(record) {
          operations.push({ type: "create", record });
          return batch;
        },
        delete(record) {
          operations.push({ type: "delete", record });
          return batch;
        },
        commit,
      };
      return batch;
    },
  };
  return { database, operations, fetchRecords, commit };
}

async function storedRecord(
  overrides: { envelope?: unknown; appleSub?: unknown; [key: string]: unknown } = {},
) {
  const { envelope, appleSub, ...recordOverrides } = overrides;
  return {
    recordName: PASSPORT_FILE_RECORD_NAME,
    recordType: PASSPORT_FILE_RECORD_TYPE,
    recordChangeTag: "tag-1",
    fields: {
      envelope: { value: "envelope" in overrides ? envelope : SERIALIZED },
      appleSub: { value: "appleSub" in overrides ? appleSub : await appleSubjectHash(SUBJECT) },
    },
    ...recordOverrides,
  };
}

function store(database: CloudKitDatabase) {
  return new ICloudPassportFileStore(database, SUBJECT, ORIGIN);
}

describe("ICloudPassportFileStore", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("record name", () => {
    it("is one record per Passport origin", async () => {
      expect(PASSPORT_FILE_RECORD_NAME).toMatch(/^pubky-passport-file-v1-[0-9a-f]{32}$/u);
      expect(await passportFileRecordName("https://staging.passport.pubky.app")).not.toBe(
        PASSPORT_FILE_RECORD_NAME,
      );
    });

    it("refuses an envelope written for another Passport origin", async () => {
      vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const { database } = fakeDatabase({
        fetch: async () => ({
          records: [
            await storedRecord({
              envelope: serializePassportFileEnvelope({
                ...ENVELOPE,
                url: "https://staging.passport.pubky.app",
              }),
            }),
          ],
        }),
      });
      expectResultError(await store(database).readPassportFile(), { code: "other_origin" });
    });
  });

  describe("readPassportFile", () => {
    it.each([
      ["per-record serverErrorCode", async () => ({ records: [{ serverErrorCode: "NOT_FOUND" }] })],
      [
        "errors list",
        async () => ({ hasErrors: true, errors: [{ ckErrorCode: "NOT_FOUND" }], records: [] }),
      ],
      [
        "rejected request",
        async (): Promise<CloudKitResponse> => {
          throw { ckErrorCode: "NOT_FOUND" };
        },
      ],
      ["empty records", async () => ({ records: [] })],
    ])("reports a missing record from a %s", async (_name, fetch) => {
      vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const { database } = fakeDatabase({ fetch });
      expect(expectResultOk(await store(database).readPassportFile())).toEqual({
        status: "missing",
      });
    });

    it("returns a valid envelope with its change tag", async () => {
      const record = await storedRecord();
      const { database } = fakeDatabase({ fetch: async () => ({ records: [record] }) });

      expect(expectResultOk(await store(database).readPassportFile())).toEqual({
        status: "found",
        envelope: ENVELOPE,
        reference: { recordName: PASSPORT_FILE_RECORD_NAME, recordChangeTag: "tag-1" },
      });
    });

    it.each([
      ["malformed envelope JSON", { envelope: "{not json" }],
      ["an envelope with extra fields", { envelope: JSON.stringify({ ...ENVELOPE, x: 1 }) }],
      ["a missing envelope", { envelope: undefined }],
      ["an oversized envelope", { envelope: "x".repeat(5000) }],
      ["another record type", { recordType: "Other" }],
      ["another record name", { recordName: "other" }],
      ["a missing change tag", { recordChangeTag: "" }],
    ])("rejects %s as invalid_file", async (_name, overrides) => {
      vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const record = await storedRecord(overrides);
      const { database } = fakeDatabase({ fetch: async () => ({ records: [record] }) });

      expectResultError(await store(database).readPassportFile(), { code: "invalid_file" });
    });

    it.each([
      ["another subject", async () => appleSubjectHash("other-subject")],
      ["no subject hash", async () => undefined],
      ["the raw subject", async () => SUBJECT],
    ])("reports account_mismatch for %s", async (_name, appleSub) => {
      vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const record = await storedRecord({ appleSub: await appleSub() });
      const { database } = fakeDatabase({ fetch: async () => ({ records: [record] }) });

      expectResultError(await store(database).readPassportFile(), { code: "account_mismatch" });
    });

    it.each([
      ["AUTHENTICATION_REQUIRED", "not_signed_in"],
      ["AUTHENTICATION_FAILED", "not_signed_in"],
      ["NETWORK_ERROR", "network_failed"],
      ["INTERNAL_ERROR", "invalid_response"],
    ])("maps a rejected %s to %s", async (ckErrorCode, code) => {
      vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const { database } = fakeDatabase({
        fetch: async () => {
          throw { ckErrorCode };
        },
      });

      expectResultError(await store(database).readPassportFile(), {
        code: code as "not_signed_in",
        cloudKitCode: ckErrorCode,
      });
    });

    it("never logs the envelope or the Apple subject", async () => {
      const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
      const mismatched = await storedRecord({ appleSub: await appleSubjectHash("other") });
      const invalid = await storedRecord({ envelope: `${SERIALIZED}x` });
      for (const record of [mismatched, invalid]) {
        const { database } = fakeDatabase({ fetch: async () => ({ records: [record] }) });
        await store(database).readPassportFile();
      }

      const logged = JSON.stringify([...warn.mock.calls, ...info.mock.calls]);
      expect(logged).not.toContain(ENVELOPE.ct);
      expect(logged).not.toContain("SECRET-APPLE-SUBJECT");
    });
  });

  describe("createPassportFile", () => {
    it("round-trips the attached marker through the record", async () => {
      const attached = { ...ENVELOPE, attached: true as const };
      const { database, operations } = fakeDatabase({});
      expectResultOk(await store(database).createPassportFile(attached));
      const created = operations[0];
      if (created?.type !== "create") throw new Error("Expected a create");
      const written = (created.record.fields as { envelope: { value: string } }).envelope.value;
      expect(written).toBe(`${SERIALIZED.slice(0, -1)},"attached":true}`);

      const record = await storedRecord({ envelope: written });
      const read = fakeDatabase({ fetch: async () => ({ records: [record] }) });
      expect(expectResultOk(await store(read.database).readPassportFile())).toMatchObject({
        status: "found",
        envelope: attached,
      });
    });

    it("creates exactly the Passport record with the envelope and subject hash", async () => {
      const { database, operations } = fakeDatabase({});

      expectResultOk(await store(database).createPassportFile(ENVELOPE));

      expect(operations).toEqual([
        {
          type: "create",
          record: {
            recordType: "PassportFile",
            recordName: PASSPORT_FILE_RECORD_NAME,
            fields: {
              envelope: { value: SERIALIZED },
              appleSub: { value: await appleSubjectHash(SUBJECT) },
            },
          },
        },
      ]);
      const create = operations[0];
      expect(JSON.stringify(create)).not.toContain("SECRET-APPLE-SUBJECT");
    });

    it.each([
      ["CONFLICT", "create_conflict"],
      ["EXISTS", "create_conflict"],
      ["QUOTA_EXCEEDED", "quota_exceeded"],
      ["AUTHENTICATION_REQUIRED", "not_signed_in"],
      ["INTERNAL_ERROR", "write_failed"],
    ])("maps a per-record %s to %s", async (serverErrorCode, code) => {
      vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const { database } = fakeDatabase({
        commit: async () => ({ hasErrors: true, errors: [{ serverErrorCode }] }),
      });

      expectResultError(await store(database).createPassportFile(ENVELOPE), {
        code: code as "write_failed",
        cloudKitCode: serverErrorCode,
      });
    });

    it("maps a rejected commit", async () => {
      vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const { database } = fakeDatabase({
        commit: async () => {
          throw { ckErrorCode: "QUOTA_EXCEEDED" };
        },
      });

      expectResultError(await store(database).createPassportFile(ENVELOPE), {
        code: "quota_exceeded",
        cloudKitCode: "QUOTA_EXCEEDED",
      });
    });

    it("refuses an invalid envelope without writing", async () => {
      vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const { database, operations } = fakeDatabase({});

      expectResultError(await store(database).createPassportFile({ ...ENVELOPE, ct: "short" }), {
        code: "invalid_file",
      });
      expect(operations).toEqual([]);
    });
  });

  describe("deletePassportFile", () => {
    const reference = { recordName: PASSPORT_FILE_RECORD_NAME, recordChangeTag: "tag-7" };

    it("deletes the exact record version", async () => {
      const { database, operations } = fakeDatabase({});

      expectResultOk(await store(database).deletePassportFile(reference));
      expect(operations).toEqual([{ type: "delete", record: reference }]);
    });

    it("treats an already deleted record as deleted", async () => {
      const { database } = fakeDatabase({
        commit: async () => ({ hasErrors: true, errors: [{ serverErrorCode: "NOT_FOUND" }] }),
      });

      expect(Result.isOk(await store(database).deletePassportFile(reference))).toBe(true);
    });

    it.each([
      ["CONFLICT", "stale_file"],
      ["AUTHENTICATION_REQUIRED", "not_signed_in"],
      ["INTERNAL_ERROR", "delete_failed"],
    ])("maps %s to %s", async (serverErrorCode, code) => {
      vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const { database } = fakeDatabase({
        commit: async () => ({ hasErrors: true, errors: [{ serverErrorCode }] }),
      });

      expectResultError(await store(database).deletePassportFile(reference), {
        code: code as "delete_failed",
        cloudKitCode: serverErrorCode,
      });
    });
  });

  describe("deleteInvalidPassportFile", () => {
    it("reports a missing record without deleting", async () => {
      const { database, operations } = fakeDatabase({
        fetch: async () => ({ records: [{ serverErrorCode: "NOT_FOUND" }] }),
      });

      expect(expectResultOk(await store(database).deleteInvalidPassportFile())).toBe("missing");
      expect(operations).toEqual([]);
    });

    it("keeps a record that became valid", async () => {
      vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const record = await storedRecord();
      const { database, operations } = fakeDatabase({ fetch: async () => ({ records: [record] }) });

      expectResultError(await store(database).deleteInvalidPassportFile(), {
        code: "stale_file",
      });
      expect(operations).toEqual([]);
    });

    it("keeps a record that belongs to another Apple Account", async () => {
      vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const record = await storedRecord({
        envelope: "{",
        appleSub: await appleSubjectHash("other"),
      });
      const { database, operations } = fakeDatabase({ fetch: async () => ({ records: [record] }) });

      expectResultError(await store(database).deleteInvalidPassportFile(), {
        code: "account_mismatch",
      });
      expect(operations).toEqual([]);
    });

    it("deletes an invalid record by its change tag", async () => {
      const record = await storedRecord({ envelope: "{", recordChangeTag: "tag-9" });
      const { database, operations } = fakeDatabase({ fetch: async () => ({ records: [record] }) });

      expect(expectResultOk(await store(database).deleteInvalidPassportFile())).toBe("deleted");
      expect(operations).toEqual([
        {
          type: "delete",
          record: { recordName: PASSPORT_FILE_RECORD_NAME, recordChangeTag: "tag-9" },
        },
      ]);
    });
  });

  describe("appleSubjectHash", () => {
    it("is deterministic, per subject, and domain separated", async () => {
      const first = await appleSubjectHash(SUBJECT);
      expect(await appleSubjectHash(SUBJECT)).toBe(first);
      expect(await appleSubjectHash("other")).not.toBe(first);
      expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(first).not.toContain("SECRET");

      const plain = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SUBJECT)),
      );
      const plainBase64Url = Buffer.from(plain).toString("base64url");
      expect(first).not.toBe(plainBase64Url);
    });
  });
});
