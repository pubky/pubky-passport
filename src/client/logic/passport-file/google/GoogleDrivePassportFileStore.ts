import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { readBoundedText } from "@/libs/http/boundedBody";
import { createFailure } from "@/libs/logger/createFailure";
import { safeErrorLogFields } from "@/libs/logger/logger";
import { MAXIMUM_JSON_BODY_BYTES } from "@/libs/passportPolicy";
import type { CodedFailure } from "@/libs/result";
import {
  parsePassportFileContents,
  serializePassportFileEnvelope,
  type PassportFileEnvelope,
} from "@/client/logic/passport-file/passportFileEnvelope";
import {
  authorizationHeaders,
  createDriveHttpResponseFailure,
  DRIVE_FILES_URL,
  DRIVE_MULTIPART_CONTENT_TYPE,
  DRIVE_UPLOAD_FILES_URL,
  driveFileUrl,
  fetchDrive,
  isDriveFile,
  mapDriveStatus,
  multipartBody,
  parseDriveFileRevision,
  parseDriveFileList,
  readDriveJson,
  sameDriveFileIdentity,
  sameDriveFileRevision,
  type DriveFileRevision,
} from "./driveHttp";

/** Stable operational Drive-store failure codes. */
type StoreErrorCode =
  | "unauthorized"
  | "forbidden"
  | "network_failed"
  | "invalid_response"
  | "invalid_file"
  | "unsupported_file"
  | "duplicate_files"
  | "create_conflict"
  | "stale_file"
  | "write_failed"
  | "delete_failed";

type StoreFailure = CodedFailure<StoreErrorCode> & { httpStatus?: number };
type StoreResult<Success> = ResultType<Success, StoreFailure>;
type PassportFileMetadataFailure = StoreFailure | CodedFailure<"exact_file_missing">;
/** Result of looking up the sole operational Passport file in `appDataFolder`. */
type PassportFileReadResult =
  | { status: "found"; envelope: PassportFileEnvelope; reference: DriveFileRevision }
  | { status: "missing" };
type LocatedFile = { status: "missing" } | { status: "found"; reference: DriveFileRevision };
type InspectedPassportFileMedia =
  { status: "valid"; envelope: PassportFileEnvelope } | { status: "invalid" };
type RequestLock = <LockResult>(
  name: string,
  callback: () => Promise<LockResult>,
) => Promise<LockResult>;

const failure = createFailure<StoreErrorCode>("identity.google.drive_store.failed");
const PASSPORT_FILE_NAME = "passport.json";
const CREATE_PASSPORT_FILE_LOCK_NAME = "pubky-passport:google-drive:passport-file:create:v1";

/**
 * Owns the authoritative `appDataFolder/passport.json` Drive operations.
 *
 * The access token is operation-scoped and never returned or persisted. Reads and
 * deletes verify exact Drive revisions. Creates verify the stable file
 * ID and uniqueness because Drive may advance `version` for invisible server-side
 * changes immediately after upload.
 */
export class GoogleDrivePassportFileStore {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  /**
   * Reads and validates the sole operational Passport file.
   *
   * A missing file is an expected result. A found file is size-bounded, parsed as
   * a strict v1 envelope, and revalidated against its exact Drive revision before
   * it is returned.
   */
  async readPassportFile(): Promise<StoreResult<PassportFileReadResult>> {
    const token = this.getAccessToken();
    if (Result.isError(token)) return Result.err(token.error);

    const located = await this.locatePassportFile(token.value);
    if (Result.isError(located)) return Result.err(located.error);
    if (located.value.status === "missing") return Result.ok({ status: "missing" });

    const inspected = await this.inspectPassportFileMedia(
      token.value,
      located.value.reference.storageId,
    );
    if (Result.isError(inspected)) return Result.err(inspected.error);
    if (inspected.value.status === "invalid") {
      return failure({
        operation: "read_media",
        code: "invalid_file",
      });
    }

    const revalidated = await this.readPassportFileMetadata(
      token.value,
      located.value.reference.storageId,
    );
    if (Result.isError(revalidated)) {
      if (revalidated.error.code !== "exact_file_missing") {
        return Result.err(revalidated.error);
      }
      return failure(
        {
          operation: "read_metadata",
          code: "stale_file",
        },
        { code: "stale_file", cause: revalidated.error },
      );
    }
    if (!sameDriveFileRevision(revalidated.value, located.value.reference)) {
      return failure({
        operation: "read_metadata",
        code: "stale_file",
      });
    }

    return Result.ok({
      status: "found",
      envelope: inspected.value.envelope,
      reference: located.value.reference,
    });
  }

  /** Deletes the sole file only after confirming its current media is malformed. */
  async deleteInvalidPassportFile(): Promise<StoreResult<"deleted" | "missing">> {
    const token = this.getAccessToken();
    if (Result.isError(token)) return Result.err(token.error);

    const located = await this.locatePassportFile(token.value);
    if (Result.isError(located)) return Result.err(located.error);
    if (located.value.status === "missing") return Result.ok("missing");

    const inspected = await this.inspectPassportFileMedia(
      token.value,
      located.value.reference.storageId,
    );
    if (Result.isError(inspected)) return Result.err(inspected.error);
    if (inspected.value.status === "valid") {
      return failure({
        operation: "delete_invalid",
        code: "stale_file",
      });
    }

    const deleted = await this.deletePassportFile(located.value.reference);
    return Result.isError(deleted) ? Result.err(deleted.error) : Result.ok("deleted");
  }

  /**
   * Creates `passport.json` only when no operational file exists.
   *
   * The method never updates existing media. It serializes only validated v1
   * fields, rejects observed conflicts, and uses a Web Lock for same-origin
   * coordination when the browser provides one.
   */
  async createPassportFile(envelope: PassportFileEnvelope): Promise<StoreResult<void>> {
    const serializedEnvelope = serializePassportFileEnvelope(envelope);
    if (serializedEnvelope === null) {
      return failure({
        operation: "serialize_envelope",
        code: "invalid_file",
      });
    }

    const token = this.getAccessToken();
    if (Result.isError(token)) return Result.err(token.error);

    const create = () => this.createMissingPassportFile(token.value, serializedEnvelope);

    const requestLock = browserRequestLock();
    if (requestLock === null) return create();
    try {
      return await requestLock(CREATE_PASSPORT_FILE_LOCK_NAME, create);
    } catch (e) {
      return failure(
        {
          operation: "create_lock",
          code: "write_failed",
          ...safeErrorLogFields(e),
        },
        { code: "write_failed", cause: e },
      );
    }
  }

  /**
   * Revalidates the supplied file ID and revision immediately before deleting by
   * file ID. Metadata changes are rejected as stale; an exact-file `404` is
   * idempotent success.
   */
  async deletePassportFile(reference: DriveFileRevision): Promise<StoreResult<void>> {
    const token = this.getAccessToken();
    if (Result.isError(token)) return Result.err(token.error);

    const current = await this.readPassportFileMetadata(token.value, reference.storageId);
    if (Result.isError(current)) {
      if (current.error.code === "exact_file_missing") return Result.ok();
      return Result.err(current.error);
    }
    if (!sameDriveFileRevision(current.value, reference)) {
      return failure({
        operation: "delete",
        code: "stale_file",
      });
    }

    const response = await this.fetchStore("delete", driveFileUrl(reference.storageId), {
      method: "DELETE",
      headers: authorizationHeaders(token.value),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (response.value.status === 404 || response.value.ok) return Result.ok();
    return this.httpResponseFailure(
      response.value,
      "delete",
      mapDriveStatus(response.value.status, "delete_failed"),
    );
  }

  private getAccessToken(): StoreResult<string> {
    if (this.accessToken.length > 0) return Result.ok(this.accessToken);
    return failure({
      operation: "access_token",
      code: "unauthorized",
    });
  }

  private async createMissingPassportFile(
    token: string,
    contents: string,
  ): Promise<StoreResult<void>> {
    const beforeCreate = await this.locateForCreate(token);
    if (Result.isError(beforeCreate)) return Result.err(beforeCreate.error);
    if (beforeCreate.value.status === "found") {
      return failure({
        operation: "create",
        code: "create_conflict",
      });
    }

    const response = await this.fetchStore("create", passportFileCreateUrl(), {
      method: "POST",
      headers: {
        ...authorizationHeaders(token),
        "Content-Type": DRIVE_MULTIPART_CONTENT_TYPE,
      },
      body: multipartBody(contents, {
        name: PASSPORT_FILE_NAME,
        parents: ["appDataFolder"],
      }),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (!response.value.ok) {
      return this.httpResponseFailure(
        response.value,
        "create",
        mapDriveStatus(response.value.status, "write_failed"),
      );
    }

    const created = await this.parseCreatedFileReference(response.value);
    if (Result.isError(created)) return Result.err(created.error);

    const afterCreate = await this.locateForCreate(token);
    if (Result.isError(afterCreate)) return Result.err(afterCreate.error);
    if (
      afterCreate.value.status === "missing" ||
      !sameDriveFileIdentity(afterCreate.value.reference, created.value)
    ) {
      return failure({
        operation: "create",
        code: "create_conflict",
      });
    }

    return Result.ok();
  }

  private async locateForCreate(token: string): Promise<StoreResult<LocatedFile>> {
    const located = await this.locatePassportFile(token);
    if (Result.isError(located) && located.error.code === "duplicate_files") {
      return failure(
        {
          operation: "create",
          code: "create_conflict",
        },
        { code: "create_conflict", cause: located.error },
      );
    }
    return located;
  }

  private async locatePassportFile(token: string): Promise<StoreResult<LocatedFile>> {
    const response = await this.fetchStore("list", passportFileListUrl(), {
      headers: authorizationHeaders(token),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (!response.value.ok) {
      return this.httpResponseFailure(
        response.value,
        "list",
        mapDriveStatus(response.value.status, "invalid_response"),
      );
    }

    const parsed = await readDriveJson(response.value);
    if (Result.isError(parsed)) {
      return failure(
        {
          operation: "parse_list_response",
          code: "invalid_response",
          ...safeErrorLogFields(parsed.error.cause),
        },
        { code: "invalid_response", cause: parsed.error.cause },
      );
    }
    const list = parseDriveFileList(parsed.value);
    if (list === null) {
      return failure({
        operation: "parse_list_response",
        code: "invalid_response",
      });
    }

    const files = list.files.map((file) => ({
      name: file.name,
      reference: parseDriveFileRevision(file),
    }));
    if (files.some((file) => file.name !== PASSPORT_FILE_NAME || file.reference === null)) {
      return failure({
        operation: "parse_list_response",
        code: "invalid_response",
      });
    }
    if (files.length === 0 && !list.nextPageToken) return Result.ok({ status: "missing" });
    if (files.length !== 1 || list.nextPageToken) {
      return failure({
        operation: "list",
        code: "duplicate_files",
      });
    }

    const file = files[0];
    if (!file || file.reference === null) {
      return failure({
        operation: "parse_list_response",
        code: "invalid_response",
      });
    }
    return Result.ok({
      status: "found",
      reference: file.reference,
    });
  }

  private async readPassportFileMetadata(
    token: string,
    fileId: string,
  ): Promise<ResultType<DriveFileRevision, PassportFileMetadataFailure>> {
    const response = await this.fetchStore("read_metadata", passportFileMetadataUrl(fileId), {
      headers: authorizationHeaders(token),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (response.value.status === 404) return Result.err({ code: "exact_file_missing" });
    if (!response.value.ok) {
      return this.httpResponseFailure(
        response.value,
        "read_metadata",
        mapDriveStatus(response.value.status, "invalid_response"),
      );
    }

    return this.parseCurrentFileReference(response.value);
  }

  private async inspectPassportFileMedia(
    token: string,
    fileId: string,
  ): Promise<StoreResult<InspectedPassportFileMedia>> {
    const response = await this.fetchStore("read_media", passportFileMediaUrl(fileId), {
      headers: authorizationHeaders(token),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (response.value.status === 404) {
      return failure({
        operation: "read_media",
        code: "stale_file",
      });
    }
    if (!response.value.ok) {
      return this.httpResponseFailure(
        response.value,
        "read_media",
        mapDriveStatus(response.value.status, "invalid_response"),
      );
    }

    const contents = await readBoundedText(response.value, MAXIMUM_JSON_BODY_BYTES);
    if (Result.isError(contents) && contents.error.code === "body_too_large") {
      return failure({
        operation: "read_media",
        code: "unsupported_file",
      });
    }
    if (Result.isError(contents)) {
      return failure(
        {
          operation: "read_media",
          code: "invalid_response",
        },
        { code: "invalid_response", cause: contents.error.cause },
      );
    }

    const parsed = parsePassportFileContents(contents.value);
    if (Result.isError(parsed)) {
      if (parsed.error.code !== "unsupported_version") return Result.ok({ status: "invalid" });
      return failure(
        {
          operation: "read_media",
          code: "unsupported_file",
        },
        { code: "unsupported_file", cause: parsed.error },
      );
    }
    return Result.ok({ status: "valid", envelope: parsed.value });
  }

  private async parseCreatedFileReference(
    response: Response,
  ): Promise<StoreResult<DriveFileRevision>> {
    const file = await readDriveJson(response);
    if (Result.isError(file)) {
      return failure(
        {
          operation: "parse_create_response",
          code: "invalid_response",
          ...safeErrorLogFields(file.error.cause),
        },
        { code: "invalid_response", cause: file.error.cause },
      );
    }
    if (!isDriveFile(file.value)) {
      return failure({
        operation: "parse_create_response",
        code: "invalid_response",
      });
    }

    const reference = parseDriveFileRevision(file.value);
    if (
      reference === null ||
      typeof file.value.name !== "string" ||
      file.value.name !== PASSPORT_FILE_NAME ||
      file.value.trashed === true
    ) {
      return failure({
        operation: "parse_create_response",
        code: "invalid_response",
      });
    }
    return Result.ok(reference);
  }

  private async parseCurrentFileReference(
    response: Response,
  ): Promise<StoreResult<DriveFileRevision>> {
    const file = await readDriveJson(response);
    if (Result.isError(file)) {
      return failure(
        {
          operation: "parse_metadata_response",
          code: "invalid_response",
          ...safeErrorLogFields(file.error.cause),
        },
        { code: "invalid_response", cause: file.error.cause },
      );
    }
    if (!isDriveFile(file.value)) {
      return failure({
        operation: "parse_metadata_response",
        code: "invalid_response",
      });
    }

    const reference = parseDriveFileRevision(file.value);
    if (
      reference === null ||
      typeof file.value.name !== "string" ||
      typeof file.value.trashed !== "boolean"
    ) {
      return failure({
        operation: "parse_metadata_response",
        code: "invalid_response",
      });
    }
    if (file.value.name !== PASSPORT_FILE_NAME || file.value.trashed) {
      return failure({
        operation: "parse_metadata_response",
        code: "stale_file",
      });
    }
    return Result.ok(reference);
  }

  private async fetchStore(
    operation: StoreOperation,
    input: string,
    init: RequestInit,
  ): Promise<StoreResult<Response>> {
    const response = await fetchDrive(this.fetchImpl, input, init);
    if (!Result.isError(response)) return Result.ok(response.value);
    return failure(
      {
        operation,
        code: "network_failed",
        ...safeErrorLogFields(response.error.cause),
      },
      response.error,
    );
  }

  private async httpResponseFailure<Success>(
    response: Response,
    operation: StoreOperation,
    code: StoreErrorCode,
  ): Promise<StoreResult<Success>> {
    const responseFailure = await createDriveHttpResponseFailure(response, code);
    return failure(
      {
        operation,
        code,
        httpStatus: responseFailure.httpStatus,
        ...safeErrorLogFields(responseFailure.cause),
      },
      responseFailure,
    );
  }
}

function browserRequestLock(): RequestLock | null {
  if (typeof navigator === "undefined" || navigator.locks === undefined) return null;
  return <LockResult>(name: string, callback: () => Promise<LockResult>) =>
    navigator.locks.request(name, callback);
}

function passportFileListUrl(): string {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name = '${PASSPORT_FILE_NAME}' and trashed = false`,
    fields: "nextPageToken,files(id,name,version)",
    pageSize: "2",
  });
  return `${DRIVE_FILES_URL}?${params.toString()}`;
}

function passportFileCreateUrl(): string {
  const params = new URLSearchParams({ uploadType: "multipart", fields: "id,name,version" });
  return `${DRIVE_UPLOAD_FILES_URL}?${params.toString()}`;
}

function passportFileMediaUrl(fileId: string): string {
  return `${driveFileUrl(fileId)}?alt=media`;
}

function passportFileMetadataUrl(fileId: string): string {
  const params = new URLSearchParams({ fields: "id,name,version,trashed" });
  return `${driveFileUrl(fileId)}?${params.toString()}`;
}

type StoreOperation =
  | "access_token"
  | "list"
  | "read_media"
  | "read_metadata"
  | "create"
  | "delete"
  | "delete_invalid"
  | "create_lock"
  | "serialize_envelope"
  | "parse_list_response"
  | "parse_metadata_response"
  | "parse_create_response";
