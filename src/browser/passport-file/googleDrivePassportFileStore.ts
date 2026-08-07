import "client-only";

import { Result, type Result as ResultType } from "better-result";

import {
  parsePassportFileContents,
  parsePassportFileEnvelope,
  type PassportFileEnvelopeV1,
} from "./passportFileEnvelope";
import { readBoundedText } from "../../libs/http/boundedBody";
import { LOGGER } from "../../libs/logger/logger";

export type PassportFileReference = Readonly<{
  storageId: string;
  revision: string;
}>;

export type PassportFileReadResult =
  | { status: "found"; envelope: PassportFileEnvelopeV1; reference: PassportFileReference }
  | { status: "missing" };

export type PassportFileStoreErrorCode =
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

export type PassportFileStoreResult<T> = ResultType<T, { code: PassportFileStoreErrorCode }>;

export type GoogleDriveAccessTokenProvider = () => Promise<string | null | undefined>;

type RequestLock = <T>(name: string, callback: () => Promise<T>) => Promise<T>;

export type GoogleDrivePassportFileStoreOptions = {
  accessTokenProvider: GoogleDriveAccessTokenProvider;
  fetch: typeof fetch;
  requestLock?: RequestLock | null;
};

type DriveFile = {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  trashed?: unknown;
};

type DriveListResponse = {
  files?: unknown;
  nextPageToken?: unknown;
};

type LocatedFileState = { status: "missing" } | { status: "found"; reference: PassportFileReference };
type LocatedFileResult = ResultType<LocatedFileState, { code: PassportFileStoreErrorCode }>;

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_FILES_URL = "https://www.googleapis.com/upload/drive/v3/files";
const PASSPORT_FILE_NAME = "passport.json";
const MULTIPART_BOUNDARY = "pubky-passport-drive-boundary-v1";
const MAXIMUM_PASSPORT_FILE_BYTES = 16 * 1024;
const MAXIMUM_DRIVE_RESPONSE_BYTES = 16 * 1024;
const CREATE_PASSPORT_FILE_LOCK_NAME = "pubky-passport:google-drive:passport-file:create:v1";
const INVALID_JSON = Symbol("invalid_json");

export class GoogleDrivePassportFileStore {
  private readonly accessTokenProvider: GoogleDriveAccessTokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly requestLock: RequestLock | null;

  constructor(options: GoogleDrivePassportFileStoreOptions) {
    this.accessTokenProvider = options.accessTokenProvider;
    this.fetchImpl = options.fetch;
    this.requestLock = options.requestLock === undefined ? browserRequestLock() : options.requestLock;
  }

  async readPassportFile(): Promise<PassportFileStoreResult<PassportFileReadResult>> {
    const token = await this.getAccessToken();
    if (Result.isError(token)) return propagateFailure(token.error);

    const located = await this.locatePassportFile(token.value);
    if (Result.isError(located)) return propagateFailure(located.error);
    if (located.value.status === "missing") return success({ status: "missing" });

    const response = await this.fetchDrive("read_media", mediaReadUrl(located.value.reference.storageId), {
      headers: authorizationHeaders(token.value),
    });
    if (response.status === 404) return failure("stale_file", "read_media");
    if (!response.ok) return response.status === 599
      ? propagateFailure({ code: "network_failed" })
      : failure(mapDriveStatus(response.status, "invalid_response"), "read_media");

    const contents = await readBoundedText(response, MAXIMUM_PASSPORT_FILE_BYTES);
    if (contents === "too_large") return failure("invalid_file", "read_media");
    if (contents === null) return failure("invalid_response", "read_media");

    const parsed = parsePassportFileContents(contents);
    if (Result.isError(parsed)) return failure("invalid_file", "read_media");

    const revalidated = await this.readExactMetadata(token.value, located.value.reference.storageId);
    if (Result.isError(revalidated)) {
      return revalidated.error.code === "exact_file_missing"
        ? failure("stale_file", "read_metadata")
        : propagateFailure({ code: revalidated.error.code });
    }
    if (!sameReference(revalidated.value, located.value.reference)) return failure("stale_file", "read_metadata");

    return success({ status: "found", envelope: parsed.value, reference: located.value.reference });
  }

  async createPassportFile(envelope: PassportFileEnvelopeV1): Promise<PassportFileStoreResult<void>> {
    const serializedEnvelope = serializeEnvelope(envelope);
    if (Result.isError(serializedEnvelope)) return propagateFailure(serializedEnvelope.error);

    const token = await this.getAccessToken();
    if (Result.isError(token)) return propagateFailure(token.error);

    const create = () => this.createPassportFileUnlocked(token.value, serializedEnvelope.value);
    if (this.requestLock === null) return create();

    try {
      return await this.requestLock(CREATE_PASSPORT_FILE_LOCK_NAME, create);
    } catch {
      return failure("write_failed", "create_lock");
    }
  }

  private async createPassportFileUnlocked(
    token: string,
    serializedEnvelope: string,
  ): Promise<PassportFileStoreResult<void>> {
    const located = await this.locatePassportFile(token);
    if (Result.isError(located)) {
      return located.error.code === "duplicate_files"
        ? failure("create_conflict", "create")
        : propagateFailure(located.error);
    }
    if (located.value.status === "found") return failure("create_conflict", "create");

    const response = await this.fetchDrive("create", createUrl(), {
      method: "POST",
      headers: {
        ...authorizationHeaders(token),
        "Content-Type": `multipart/related; boundary=${MULTIPART_BOUNDARY}`,
      },
      body: createMultipartBody(serializedEnvelope, {
        name: PASSPORT_FILE_NAME,
        parents: ["appDataFolder"],
      }),
    });
    if (!response.ok) return response.status === 599
      ? propagateFailure({ code: "network_failed" })
      : failure(mapDriveStatus(response.status, "write_failed"), "create");

    const created = await parseDriveFileResponse(response, PASSPORT_FILE_NAME);
    if (Result.isError(created)) return propagateFailure(created.error);

    const checked = await this.locatePassportFile(token);
    if (Result.isError(checked)) {
      return checked.error.code === "duplicate_files"
        ? failure("create_conflict", "create")
        : propagateFailure(checked.error);
    }
    if (checked.value.status === "missing" || !sameReference(checked.value.reference, created.value)) {
      return failure("create_conflict", "create");
    }

    return success(undefined);
  }

  async deletePassportFile(reference: PassportFileReference): Promise<PassportFileStoreResult<void>> {
    const token = await this.getAccessToken();
    if (Result.isError(token)) return propagateFailure(token.error);

    const current = await this.readExactMetadata(token.value, reference.storageId);
    if (Result.isError(current)) {
      return current.error.code === "exact_file_missing"
        ? success(undefined)
        : propagateFailure({ code: current.error.code });
    }
    if (!sameReference(current.value, reference)) return failure("stale_file", "delete");

    const response = await this.fetchDrive("delete", deleteUrl(reference.storageId), {
      method: "DELETE",
      headers: authorizationHeaders(token.value),
    });
    if (response.status === 404 || response.ok) return success(undefined);
    return response.status === 599
      ? propagateFailure({ code: "network_failed" })
      : failure(mapDriveStatus(response.status, "delete_failed"), "delete");
  }

  private async getAccessToken(): Promise<PassportFileStoreResult<string>> {
    let token: string | null | undefined;
    try {
      token = await this.accessTokenProvider();
    } catch {
      return failure("unauthorized", "access_token");
    }
    return typeof token === "string" && token.length > 0
      ? success(token)
      : failure("unauthorized", "access_token");
  }

  private async locatePassportFile(token: string): Promise<LocatedFileResult> {
    const response = await this.fetchDrive("list", listUrl(), { headers: authorizationHeaders(token) });
    if (!response.ok) return response.status === 599
      ? propagateFailure({ code: "network_failed" })
      : failure(mapDriveStatus(response.status, "invalid_response"), "list");

    const contents = await readBoundedText(response, MAXIMUM_DRIVE_RESPONSE_BYTES);
    if (contents === null || contents === "too_large") return failure("invalid_response", "list");

    const list = parseJsonContents(contents, "parse_list_response");
    if (list === INVALID_JSON) return propagateFailure({ code: "invalid_response" });
    if (!isDriveListResponse(list)) return failure("invalid_response", "parse_list_response");

    const files = list.files.filter((file): file is { id: string; name: string; version: string } => (
      isNonEmptyString(file.id)
      && typeof file.name === "string"
      && isNonEmptyString(file.version)
      && file.name === PASSPORT_FILE_NAME
    ));
    if (files.length !== list.files.length) return failure("invalid_response", "parse_list_response");
    if (files.length === 0 && !list.nextPageToken) return Result.ok({ status: "missing" });
    if (files.length !== 1 || list.nextPageToken) return failure("duplicate_files", "list");

    const file = files[0];
    if (!file) return failure("invalid_response", "parse_list_response");
    return Result.ok({ status: "found", reference: { storageId: file.id, revision: file.version } });
  }

  private async readExactMetadata(
    token: string,
    fileId: string,
  ): Promise<ResultType<PassportFileReference, { code: PassportFileStoreErrorCode | "exact_file_missing" }>> {
    const response = await this.fetchDrive("read_metadata", metadataUrl(fileId), { headers: authorizationHeaders(token) });
    if (response.status === 404) return Result.err({ code: "exact_file_missing" });
    if (!response.ok) return response.status === 599
      ? propagateFailure({ code: "network_failed" })
      : failure(mapDriveStatus(response.status, "invalid_response"), "read_metadata");

    return parseDriveFileResponse(response, PASSPORT_FILE_NAME, true);
  }

  private async fetchDrive(operation: DriveRequestOperation, input: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(input, init);
    } catch {
      logDriveStoreFailure(operation, "network_failed");
      return new Response(null, { status: 599 });
    }
  }
}

function browserRequestLock(): RequestLock | null {
  if (typeof navigator === "undefined" || navigator.locks === undefined) return null;
  return <T>(name: string, callback: () => Promise<T>) => navigator.locks.request(name, callback);
}

function listUrl(): string {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name = '${PASSPORT_FILE_NAME}' and trashed = false`,
    fields: "nextPageToken,files(id,name,version)",
    pageSize: "2",
  });
  return `${DRIVE_FILES_URL}?${params.toString()}`;
}

function createUrl(): string {
  const params = new URLSearchParams({ uploadType: "multipart", fields: "id,name,version" });
  return `${DRIVE_UPLOAD_FILES_URL}?${params.toString()}`;
}

function mediaReadUrl(fileId: string): string {
  return `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`;
}

function metadataUrl(fileId: string): string {
  const params = new URLSearchParams({ fields: "id,name,version,trashed" });
  return `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?${params.toString()}`;
}

function deleteUrl(fileId: string): string {
  return `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`;
}

function authorizationHeaders(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function createMultipartBody(envelopeJson: string, metadataValue: { name: string; parents: string[] }): string {
  const metadata = JSON.stringify(metadataValue);
  return [
    `--${MULTIPART_BOUNDARY}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    metadata,
    `--${MULTIPART_BOUNDARY}`,
    "Content-Type: application/json",
    "",
    envelopeJson,
    `--${MULTIPART_BOUNDARY}--`,
    "",
  ].join("\r\n");
}

function serializeEnvelope(
  envelope: PassportFileEnvelopeV1,
): PassportFileStoreResult<string> {
  const parsed = parsePassportFileEnvelope(envelope);
  if (Result.isError(parsed)) return failure("invalid_file", "serialize_envelope");
  return success(JSON.stringify({ v: parsed.value.v, iv: parsed.value.iv, ct: parsed.value.ct, url: parsed.value.url }));
}

async function parseDriveFileResponse(
  response: Response,
  expectedName: string,
  requireTrashed = false,
  operation: DriveStoreOperation = requireTrashed ? "parse_metadata_response" : "parse_create_response",
): Promise<ResultType<PassportFileReference, { code: PassportFileStoreErrorCode }>> {
  const contents = await readBoundedText(response, MAXIMUM_DRIVE_RESPONSE_BYTES);
  if (contents === null || contents === "too_large") return failure("invalid_response", operation);

  const file = parseJsonContents(contents, operation);
  if (file === INVALID_JSON) return propagateFailure({ code: "invalid_response" });
  if (!isDriveFile(file)) return failure("invalid_response", operation);
  if (!isNonEmptyString(file.id) || typeof file.name !== "string" || !isNonEmptyString(file.version)) {
    return failure("invalid_response", operation);
  }
  if (requireTrashed && typeof file.trashed !== "boolean") return failure("invalid_response", operation);
  if (file.name !== expectedName || file.trashed === true) {
    return failure(requireTrashed ? "stale_file" : "invalid_response", operation);
  }
  return Result.ok({ storageId: file.id, revision: file.version });
}

function parseJsonContents(contents: string, operation: DriveStoreOperation): unknown {
  try {
    return JSON.parse(contents);
  } catch {
    logDriveStoreFailure(operation, "invalid_response");
    return INVALID_JSON;
  }
}

function isDriveListResponse(value: unknown): value is { files: DriveFile[]; nextPageToken?: string } {
  if (!value || typeof value !== "object") return false;
  const response = value as DriveListResponse;
  if (!Array.isArray(response.files)) return false;
  if (response.nextPageToken !== undefined && typeof response.nextPageToken !== "string") return false;
  return response.files.every(isDriveFile);
}

function isDriveFile(value: unknown): value is DriveFile {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function sameReference(left: PassportFileReference, right: PassportFileReference): boolean {
  return left.storageId === right.storageId && left.revision === right.revision;
}

function mapDriveStatus(status: number, fallback: PassportFileStoreErrorCode): PassportFileStoreErrorCode {
  switch (status) {
    case 599:
      return "network_failed";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    default:
      return fallback;
  }
}

function success<T>(value: T): PassportFileStoreResult<T> {
  return Result.ok(value);
}

function failure<T>(code: PassportFileStoreErrorCode, operation: DriveStoreOperation): PassportFileStoreResult<T> {
  logDriveStoreFailure(operation, code);
  return Result.err({ code });
}

function propagateFailure<T>(error: { code: PassportFileStoreErrorCode }): PassportFileStoreResult<T> {
  return Result.err(error);
}

function logDriveStoreFailure(
  operation: DriveStoreOperation,
  code: PassportFileStoreErrorCode,
): void {
  LOGGER.warn("identity.google.drive_store.failed", { operation, code });
}

type DriveRequestOperation =
  | "list"
  | "read_media"
  | "read_metadata"
  | "create"
  | "delete";
type DriveStoreOperation =
  | DriveRequestOperation
  | "create_lock"
  | "access_token"
  | "parse_list_response"
  | "parse_metadata_response"
  | "parse_create_response"
  | "serialize_envelope";
