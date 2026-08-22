import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { readBoundedText } from "../../../../libs/http/boundedBody";
import { LOGGER } from "../../../../libs/logger/logger";
import {
  parsePassportFileContents,
  serializePassportFileEnvelope,
  type PassportFileEnvelopeV1,
} from "../passportFileEnvelope";
import {
  authorizationHeaders,
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
  sameDriveFileRevision,
  type DriveFileRevision,
} from "./driveHttp";

/** Safe operational Drive-store failures that contain no credentials or file data. */
type StoreErrorCode =
  | "unauthorized"
  | "forbidden"
  | "network_failed"
  | "invalid_response"
  | "invalid_file"
  | "duplicate_files"
  | "create_conflict"
  | "stale_file"
  | "write_failed"
  | "delete_failed";

type StoreResult<Success> = ResultType<Success, { code: StoreErrorCode }>;
/** Result of looking up the sole operational Passport file in `appDataFolder`. */
type PassportFileReadResult =
  | { status: "found"; envelope: PassportFileEnvelopeV1; reference: DriveFileRevision }
  | { status: "missing" };
type LocatedFile = { status: "missing" } | { status: "found"; reference: DriveFileRevision };
type RequestLock = <LockResult>(name: string, callback: () => Promise<LockResult>) => Promise<LockResult>;

const PASSPORT_FILE_NAME = "passport.json";
const MAXIMUM_PASSPORT_FILE_BYTES = 16 * 1024;
const CREATE_PASSPORT_FILE_LOCK_NAME = "pubky-passport:google-drive:passport-file:create:v1";

/**
 * Owns the authoritative `appDataFolder/passport.json` Drive operations.
 *
 * The access token is operation-scoped and never returned or persisted. Reads,
 * creates, and deletes verify an exact Drive file revision so stale or duplicate
 * files are rejected rather than selected or overwritten.
 */
export class GoogleDrivePassportFileStore {
  constructor(
    private accessToken: string,
    private fetchImpl: typeof fetch,
    private requestLock: RequestLock | null = browserRequestLock(),
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

    const response = await this.fetchStore("read_media", passportFileMediaUrl(located.value.reference.storageId), {
      headers: authorizationHeaders(token.value),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (response.value.status === 404) return failure("stale_file", "read_media");
    if (!response.value.ok) {
      return failure(mapDriveStatus(response.value.status, "invalid_response"), "read_media");
    }

    const contents = await readBoundedText(response.value, MAXIMUM_PASSPORT_FILE_BYTES);
    if (contents === "too_large") return failure("invalid_file", "read_media");
    if (contents === null) return failure("invalid_response", "read_media");

    const parsed = parsePassportFileContents(contents);
    if (Result.isError(parsed)) return failure("invalid_file", "read_media");

    const revalidated = await this.readPassportFileMetadata(token.value, located.value.reference.storageId);
    if (Result.isError(revalidated)) {
      return revalidated.error.code === "exact_file_missing"
        ? failure("stale_file", "read_metadata")
        : Result.err({ code: revalidated.error.code });
    }
    if (!sameDriveFileRevision(revalidated.value, located.value.reference)) {
      return failure("stale_file", "read_metadata");
    }

    return Result.ok({
      status: "found",
      envelope: parsed.value,
      reference: located.value.reference,
    });
  }

  /**
   * Creates `passport.json` only when no operational file exists.
   *
   * The method never updates existing media. It serializes only validated v1
   * fields, rejects observed conflicts, and uses a Web Lock for same-origin
   * coordination when the browser provides one.
   */
  async createPassportFile(envelope: PassportFileEnvelopeV1): Promise<StoreResult<void>> {
    const serializedEnvelope = serializePassportFileEnvelope(envelope);
    if (serializedEnvelope === null) return failure("invalid_file", "serialize_envelope");

    const token = this.getAccessToken();
    if (Result.isError(token)) return Result.err(token.error);

    const create = () => this.createMissingPassportFile(token.value, serializedEnvelope);

    if (this.requestLock === null) return create();
    try {
      return await this.requestLock(CREATE_PASSPORT_FILE_LOCK_NAME, create);
    } catch {
      return failure("write_failed", "create_lock");
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
      return current.error.code === "exact_file_missing"
        ? Result.ok()
        : Result.err({ code: current.error.code });
    }
    if (!sameDriveFileRevision(current.value, reference)) return failure("stale_file", "delete");

    const response = await this.fetchStore("delete", driveFileUrl(reference.storageId), {
      method: "DELETE",
      headers: authorizationHeaders(token.value),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (response.value.status === 404 || response.value.ok) return Result.ok();
    return failure(mapDriveStatus(response.value.status, "delete_failed"), "delete");
  }

  private getAccessToken(): StoreResult<string> {
    return this.accessToken.length > 0
      ? Result.ok(this.accessToken)
      : failure("unauthorized", "access_token");
  }

  private async createMissingPassportFile(token: string, contents: string): Promise<StoreResult<void>> {
    const beforeCreate = await this.locateForCreate(token);
    if (Result.isError(beforeCreate)) return Result.err(beforeCreate.error);
    if (beforeCreate.value.status === "found") return failure("create_conflict", "create");

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
      return failure(mapDriveStatus(response.value.status, "write_failed"), "create");
    }

    const created = await this.parseCreatedFileReference(response.value);
    if (Result.isError(created)) return Result.err(created.error);

    const afterCreate = await this.locateForCreate(token);
    if (Result.isError(afterCreate)) return Result.err(afterCreate.error);
    if (afterCreate.value.status === "missing"
      || !sameDriveFileRevision(afterCreate.value.reference, created.value)) {
      return failure("create_conflict", "create");
    }

    return Result.ok();
  }

  private async locateForCreate(token: string): Promise<StoreResult<LocatedFile>> {
    const located = await this.locatePassportFile(token);
    return Result.isError(located) && located.error.code === "duplicate_files"
      ? failure("create_conflict", "create")
      : located;
  }

  private async locatePassportFile(token: string): Promise<StoreResult<LocatedFile>> {
    const response = await this.fetchStore("list", passportFileListUrl(), {
      headers: authorizationHeaders(token),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (!response.value.ok) {
      return failure(mapDriveStatus(response.value.status, "invalid_response"), "list");
    }

    const parsed = await readDriveJson(response.value);
    const list = parseDriveFileList(parsed);
    if (list === null) return failure("invalid_response", "parse_list_response");

    const files = list.files.map((file) => ({
      name: file.name,
      reference: parseDriveFileRevision(file),
    }));
    if (files.some((file) => file.name !== PASSPORT_FILE_NAME || file.reference === null)) {
      return failure("invalid_response", "parse_list_response");
    }
    if (files.length === 0 && !list.nextPageToken) return Result.ok({ status: "missing" });
    if (files.length !== 1 || list.nextPageToken) return failure("duplicate_files", "list");

    const file = files[0];
    if (!file || file.reference === null) return failure("invalid_response", "parse_list_response");
    return Result.ok({
      status: "found",
      reference: file.reference,
    });
  }

  private async readPassportFileMetadata(
    token: string,
    fileId: string,
  ): Promise<ResultType<DriveFileRevision, { code: StoreErrorCode | "exact_file_missing" }>> {
    const response = await this.fetchStore("read_metadata", passportFileMetadataUrl(fileId), {
      headers: authorizationHeaders(token),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (response.value.status === 404) return Result.err({ code: "exact_file_missing" });
    if (!response.value.ok) {
      return failure(mapDriveStatus(response.value.status, "invalid_response"), "read_metadata");
    }

    return this.parseCurrentFileReference(response.value);
  }

  private async parseCreatedFileReference(response: Response): Promise<StoreResult<DriveFileRevision>> {
    const file = await readDriveJson(response);
    if (!isDriveFile(file)) return failure("invalid_response", "parse_create_response");

    const reference = parseDriveFileRevision(file);
    if (reference === null
      || typeof file.name !== "string"
      || file.name !== PASSPORT_FILE_NAME
      || file.trashed === true) {
      return failure("invalid_response", "parse_create_response");
    }
    return Result.ok(reference);
  }

  private async parseCurrentFileReference(response: Response): Promise<StoreResult<DriveFileRevision>> {
    const file = await readDriveJson(response);
    if (!isDriveFile(file)) return failure("invalid_response", "parse_metadata_response");

    const reference = parseDriveFileRevision(file);
    if (reference === null
      || typeof file.name !== "string"
      || typeof file.trashed !== "boolean") {
      return failure("invalid_response", "parse_metadata_response");
    }
    if (file.name !== PASSPORT_FILE_NAME || file.trashed) {
      return failure("stale_file", "parse_metadata_response");
    }
    return Result.ok(reference);
  }

  private async fetchStore(
    operation: StoreOperation,
    input: string,
    init: RequestInit,
  ): Promise<StoreResult<Response>> {
    const response = await fetchDrive(this.fetchImpl, input, init);
    return response === null ? failure("network_failed", operation) : Result.ok(response);
  }
}

function browserRequestLock(): RequestLock | null {
  if (typeof navigator === "undefined" || navigator.locks === undefined) return null;
  return <LockResult>(name: string, callback: () => Promise<LockResult>) => (
    navigator.locks.request(name, callback)
  );
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

function failure<Success>(code: StoreErrorCode, operation: StoreOperation): StoreResult<Success> {
  LOGGER.warn("identity.google.drive_store.failed", { operation, code });
  return Result.err({ code });
}

type StoreOperation =
  | "access_token"
  | "list"
  | "read_media"
  | "read_metadata"
  | "create"
  | "delete"
  | "create_lock"
  | "serialize_envelope"
  | "parse_list_response"
  | "parse_metadata_response"
  | "parse_create_response";
