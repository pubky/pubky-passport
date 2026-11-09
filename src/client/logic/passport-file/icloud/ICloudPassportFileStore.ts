import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { encodeBase64Url } from "@/libs/encoding/base64Url";
import { LOGGER } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import {
  cloudKitErrorCode,
  type CloudKitDatabase,
  type CloudKitRecord,
  type CloudKitResponse,
} from "@/client/logic/apple-identity/ICloudConnection";
import {
  parsePassportFileContents,
  serializePassportFileEnvelope,
  type PassportFileEnvelope,
} from "@/client/logic/passport-file/passportFileEnvelope";
import type {
  PassportFileReadResult,
  PassportFileStore,
} from "@/client/logic/passport-file/passportFileStore";

/** CloudKit schema: deploy this record type with both fields (String) to Production. */
export const PASSPORT_FILE_RECORD_TYPE = "PassportFile";
const RECORD_NAME_PREFIX = "pubky-passport-file-v1-";

const MAXIMUM_ENVELOPE_CHARACTERS = 4 * 1024;
const APPLE_SUBJECT_HASH_LABEL = "pubky-passport/apple-sub/v1\n";

export type ICloudRecordReference = Readonly<{ recordName: string; recordChangeTag: string }>;

type StoreErrorCode =
  | "not_signed_in"
  | "quota_exceeded"
  | "network_failed"
  | "invalid_response"
  | "invalid_file"
  | "account_mismatch"
  | "other_origin"
  | "create_conflict"
  | "stale_file"
  | "write_failed"
  | "delete_failed";

export type ICloudStoreFailure = CodedFailure<StoreErrorCode> & { cloudKitCode?: string };
type StoreResult<Success> = ResultType<Success, ICloudStoreFailure>;

type RawRecord =
  | { status: "missing" }
  | {
      status: "found";
      reference: ICloudRecordReference;
      envelope: string | undefined;
      appleSubjectHash: string | undefined;
    };

/**
 * The encrypted Passport file as one CloudKit record in the user's private database.
 *
 * One record per Passport origin, because envelopes are bound to the origin that wrote them.
 * This is not isolation: every environment needs its own container and Services ID.
 * Fields: `envelope` holds the existing PassportFileEnvelope JSON unchanged; `appleSub` holds a
 * SHA-256 hash of the Sign in with Apple subject, so a record written after signing in with a
 * different Apple Account is reported as `account_mismatch` instead of a decryption failure.
 * Deletes pin the record change tag that was read, so a record another device rewrote in the
 * meantime is never removed.
 */
export class ICloudPassportFileStore implements PassportFileStore<
  ICloudRecordReference,
  ICloudStoreFailure
> {
  private readonly recordName: Promise<string>;

  /**
   * @param database The signed-in user's private CloudKit database.
   * @param appleSubject Subject of the Apple Account this file belongs to.
   * @param passportOrigin Origin of this Passport; it names the record and must match the envelope.
   */
  constructor(
    private readonly database: CloudKitDatabase,
    private readonly appleSubject: string,
    private readonly passportOrigin: string,
  ) {
    this.recordName = passportFileRecordName(passportOrigin);
  }

  async readPassportFile(): Promise<StoreResult<PassportFileReadResult<ICloudRecordReference>>> {
    const record = await this.readRecord();
    if (Result.isError(record)) return Result.err(record.error);
    if (record.value.status === "missing") return Result.ok({ status: "missing" });

    const mismatch = await this.checkAccount(record.value.appleSubjectHash);
    if (mismatch) return Result.err(mismatch);
    const envelope = parseEnvelope(record.value.envelope);
    if (!envelope) return failure("read", "invalid_file");
    if (envelope.url !== this.passportOrigin) return failure("read", "other_origin");
    return Result.ok({ status: "found", envelope, reference: record.value.reference });
  }

  async createPassportFile(envelope: PassportFileEnvelope): Promise<StoreResult<void>> {
    const serialized = serializePassportFileEnvelope(envelope);
    if (serialized === null) return failure("create", "invalid_file");
    let response: CloudKitResponse;
    try {
      response = await this.database
        .newRecordsBatch()
        .create({
          recordType: PASSPORT_FILE_RECORD_TYPE,
          recordName: await this.recordName,
          fields: {
            envelope: { value: serialized },
            appleSub: { value: await appleSubjectHash(this.appleSubject) },
          },
        })
        .commit();
    } catch (e) {
      return failure("create", writeFailureCode(e), e);
    }
    const error = firstError(response);
    if (error) return failure("create", writeFailureCode(error), error);
    return Result.ok();
  }

  async deletePassportFile(reference: ICloudRecordReference): Promise<StoreResult<void>> {
    let response: CloudKitResponse;
    try {
      response = await this.database
        .newRecordsBatch()
        .delete({ recordName: reference.recordName, recordChangeTag: reference.recordChangeTag })
        .commit();
    } catch (e) {
      return failure("delete", deleteFailureCode(e), e);
    }
    const error = firstError(response);
    if (!error || cloudKitErrorCode(error) === "NOT_FOUND") return Result.ok();
    return failure("delete", deleteFailureCode(error), error);
  }

  /** Deletes the record only while it still holds no valid envelope for this Apple Account. */
  async deleteInvalidPassportFile(): Promise<StoreResult<"deleted" | "missing">> {
    const record = await this.readRecord();
    if (Result.isError(record)) return Result.err(record.error);
    if (record.value.status === "missing") return Result.ok("missing");
    const mismatch = await this.checkAccount(record.value.appleSubjectHash);
    if (mismatch) return Result.err(mismatch);
    if (parseEnvelope(record.value.envelope)) return failure("delete_invalid", "stale_file");

    const deleted = await this.deletePassportFile(record.value.reference);
    return Result.isError(deleted) ? Result.err(deleted.error) : Result.ok("deleted");
  }

  private async readRecord(): Promise<StoreResult<RawRecord>> {
    let response: CloudKitResponse;
    try {
      response = await this.database.fetchRecords([await this.recordName]);
    } catch (e) {
      if (cloudKitErrorCode(e) === "NOT_FOUND") return Result.ok({ status: "missing" });
      return failure("read", readFailureCode(e), e);
    }

    const record = response.records?.[0];
    const error = firstError(response) ?? (record?.serverErrorCode ? record : undefined);
    if (error) {
      if (cloudKitErrorCode(error) === "NOT_FOUND") return Result.ok({ status: "missing" });
      return failure("read", readFailureCode(error), error);
    }
    if (!record || response.records?.length !== 1) {
      return record ? failure("read", "invalid_response") : Result.ok({ status: "missing" });
    }
    return toRawRecord(record, await this.recordName);
  }

  private async checkAccount(
    storedHash: string | undefined,
  ): Promise<ICloudStoreFailure | undefined> {
    if (storedHash === (await appleSubjectHash(this.appleSubject))) return undefined;
    LOGGER.warn("identity.apple.icloud_store.failed", { code: "account_mismatch" });
    return { code: "account_mismatch" };
  }
}

/** `pubky-passport-file-v1-` plus 32 hex characters of SHA-256 over the Passport origin. */
export async function passportFileRecordName(passportOrigin: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(passportOrigin),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"));
  return `${RECORD_NAME_PREFIX}${hex.join("").slice(0, 32)}`;
}

/**
 * Base64url SHA-256 of a domain-separated Apple subject. Apple sees only this hash next to the
 * ciphertext; it lets Passport tell "another Apple Account wrote this" apart from a damaged file.
 */
export async function appleSubjectHash(appleSubject: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${APPLE_SUBJECT_HASH_LABEL}${appleSubject}`),
  );
  return encodeBase64Url(new Uint8Array(digest));
}

function toRawRecord(record: CloudKitRecord, recordName: string): StoreResult<RawRecord> {
  if (
    record.recordName !== recordName ||
    record.recordType !== PASSPORT_FILE_RECORD_TYPE ||
    typeof record.recordChangeTag !== "string" ||
    record.recordChangeTag.length === 0
  ) {
    return failure("read", "invalid_file");
  }
  const fields = isRecord(record.fields) ? record.fields : {};
  return Result.ok({
    status: "found",
    reference: Object.freeze({
      recordName,
      recordChangeTag: record.recordChangeTag,
    }),
    envelope: stringField(fields.envelope),
    appleSubjectHash: stringField(fields.appleSub),
  });
}

function stringField(field: unknown): string | undefined {
  if (!isRecord(field)) return undefined;
  return typeof field.value === "string" ? field.value : undefined;
}

function parseEnvelope(value: string | undefined): PassportFileEnvelope | undefined {
  if (value === undefined || value.length > MAXIMUM_ENVELOPE_CHARACTERS) return undefined;
  const parsed = parsePassportFileContents(value);
  return Result.isOk(parsed) ? parsed.value : undefined;
}

function firstError(response: CloudKitResponse): CloudKitRecord | undefined {
  if (!isRecord(response)) return { serverErrorCode: "INVALID_RESPONSE" };
  const errors = Array.isArray(response.errors) ? response.errors : [];
  if (errors.length > 0) return errors[0] as CloudKitRecord;
  if (response.hasErrors) return { serverErrorCode: "UNKNOWN" };
  return undefined;
}

function readFailureCode(error: unknown): StoreErrorCode {
  return commonFailureCode(error) ?? "invalid_response";
}

function writeFailureCode(error: unknown): StoreErrorCode {
  const code = cloudKitErrorCode(error);
  if (code === "CONFLICT" || code === "EXISTS") return "create_conflict";
  if (code === "QUOTA_EXCEEDED") return "quota_exceeded";
  return commonFailureCode(error) ?? "write_failed";
}

function deleteFailureCode(error: unknown): StoreErrorCode {
  if (cloudKitErrorCode(error) === "CONFLICT") return "stale_file";
  return commonFailureCode(error) ?? "delete_failed";
}

function commonFailureCode(error: unknown): StoreErrorCode | undefined {
  switch (cloudKitErrorCode(error)) {
    case "AUTHENTICATION_REQUIRED":
    case "AUTHENTICATION_FAILED":
    case "ACCESS_DENIED":
      return "not_signed_in";
    case "NETWORK_ERROR":
    case "SERVICE_UNAVAILABLE":
    case "THROTTLED":
    case "TRY_AGAIN_LATER":
      return "network_failed";
    default:
      return undefined;
  }
}

function failure<Success>(
  operation: "read" | "create" | "delete" | "delete_invalid",
  code: StoreErrorCode,
  cause?: unknown,
): StoreResult<Success> {
  const cloudKitCode = cause === undefined ? undefined : cloudKitErrorCode(cause);
  LOGGER.warn("identity.apple.icloud_store.failed", {
    operation,
    code,
    ...(cloudKitCode ? { cloudKitCode } : {}),
  });
  return Result.err({ code, ...(cloudKitCode ? { cloudKitCode } : {}) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
