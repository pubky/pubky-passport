import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { PassportFileEnvelopeV1 } from "../../core/passport-file/passportFile";
import {
  parsePassportFileContents,
  parsePassportFileEnvelope,
} from "../../core/passport-file/parsePassportFile";
import { readBoundedText } from "../../libs/http/boundedBody";
import type {
  PassportFileReadResult,
  PassportFileReference,
  PassportFileStoreErrorCode,
  PassportFileStoreResult,
} from "./passportFileStoreModels";

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
    if (Result.isError(token)) return failure(token.error.code);

    const located = await this.locatePassportFile(token.value);
    if (Result.isError(located)) return failure(located.error.code);
    if (located.value.status === "missing") return success({ status: "missing" });

    const response = await this.fetchDrive(mediaReadUrl(located.value.reference.storageId), {
      headers: authorizationHeaders(token.value),
    });
    if (response.status === 404) return failure("stale_file");
    if (!response.ok) return failure(mapDriveStatus(response.status, "invalid_response"));

    const contents = await readBoundedText(response, MAXIMUM_PASSPORT_FILE_BYTES);
    if (contents === "too_large") return failure("invalid_file");
    if (contents === null) return failure("invalid_response");

    const parsed = parsePassportFileContents(contents);
    if (Result.isError(parsed)) return failure("invalid_file");

    const revalidated = await this.readExactMetadata(token.value, located.value.reference.storageId);
    if (Result.isError(revalidated)) {
      return failure(revalidated.error.code === "exact_file_missing" ? "stale_file" : revalidated.error.code);
    }
    if (!sameReference(revalidated.value, located.value.reference)) return failure("stale_file");

    return success({ status: "found", envelope: parsed.value, reference: located.value.reference });
  }

  async createPassportFile(envelope: PassportFileEnvelopeV1): Promise<PassportFileStoreResult<PassportFileReference>> {
    const serializedEnvelope = serializeEnvelope(envelope);
    if (Result.isError(serializedEnvelope)) return failure(serializedEnvelope.error.code);

    const token = await this.getAccessToken();
    if (Result.isError(token)) return failure(token.error.code);

    const create = () => this.createPassportFileUnlocked(token.value, serializedEnvelope.value);
    if (this.requestLock === null) return create();

    try {
      return await this.requestLock(CREATE_PASSPORT_FILE_LOCK_NAME, create);
    } catch {
      return failure("write_failed");
    }
  }

  private async createPassportFileUnlocked(
    token: string,
    serializedEnvelope: string,
  ): Promise<PassportFileStoreResult<PassportFileReference>> {
    const located = await this.locatePassportFile(token);
    if (Result.isError(located)) {
      return failure(located.error.code === "duplicate_files" ? "create_conflict" : located.error.code);
    }
    if (located.value.status === "found") return failure("create_conflict");

    const response = await this.fetchDrive(createUrl(), {
      method: "POST",
      headers: {
        ...authorizationHeaders(token),
        "Content-Type": `multipart/related; boundary=${MULTIPART_BOUNDARY}`,
      },
      body: createMultipartBody(serializedEnvelope),
    });
    if (!response.ok) return failure(mapDriveStatus(response.status, "write_failed"));

    const created = await parseDriveFileResponse(response);
    if (Result.isError(created)) return failure(created.error.code);

    const checked = await this.locatePassportFile(token);
    if (Result.isError(checked)) {
      return failure(checked.error.code === "duplicate_files" ? "create_conflict" : checked.error.code);
    }
    if (checked.value.status === "missing" || !sameReference(checked.value.reference, created.value)) {
      return failure("create_conflict");
    }

    return success(created.value);
  }

  async deletePassportFile(reference: PassportFileReference): Promise<PassportFileStoreResult<void>> {
    const token = await this.getAccessToken();
    if (Result.isError(token)) return failure(token.error.code);

    const current = await this.readExactMetadata(token.value, reference.storageId);
    if (Result.isError(current)) {
      return current.error.code === "exact_file_missing" ? success(undefined) : failure(current.error.code);
    }
    if (!sameReference(current.value, reference)) return failure("stale_file");

    const response = await this.fetchDrive(deleteUrl(reference.storageId), {
      method: "DELETE",
      headers: authorizationHeaders(token.value),
    });
    if (response.status === 404 || response.ok) return success(undefined);
    return failure(mapDriveStatus(response.status, "delete_failed"));
  }

  private async getAccessToken(): Promise<PassportFileStoreResult<string>> {
    let token: string | null | undefined;
    try {
      token = await this.accessTokenProvider();
    } catch {
      return failure("unauthorized");
    }
    return typeof token === "string" && token.length > 0 ? success(token) : failure("unauthorized");
  }

  private async locatePassportFile(token: string): Promise<LocatedFileResult> {
    const response = await this.fetchDrive(listUrl(), { headers: authorizationHeaders(token) });
    if (!response.ok) return failure(mapDriveStatus(response.status, "invalid_response"));

    const contents = await readBoundedText(response, MAXIMUM_DRIVE_RESPONSE_BYTES);
    if (contents === null || contents === "too_large") return failure("invalid_response");

    const list = parseJsonContents(contents);
    if (!isDriveListResponse(list)) return failure("invalid_response");

    const files = list.files.filter((file): file is { id: string; name: string; version: string } => (
      isNonEmptyString(file.id)
      && typeof file.name === "string"
      && isNonEmptyString(file.version)
      && file.name === PASSPORT_FILE_NAME
    ));
    if (files.length !== list.files.length) return failure("invalid_response");
    if (files.length === 0 && !list.nextPageToken) return Result.ok({ status: "missing" });
    if (files.length !== 1 || list.nextPageToken) return failure("duplicate_files");

    const file = files[0];
    if (!file) return failure("invalid_response");
    return Result.ok({ status: "found", reference: { storageId: file.id, revision: file.version } });
  }

  private async readExactMetadata(
    token: string,
    fileId: string,
  ): Promise<ResultType<PassportFileReference, { code: PassportFileStoreErrorCode | "exact_file_missing" }>> {
    const response = await this.fetchDrive(metadataUrl(fileId), { headers: authorizationHeaders(token) });
    if (response.status === 404) return Result.err({ code: "exact_file_missing" });
    if (!response.ok) return Result.err({ code: mapDriveStatus(response.status, "invalid_response") });

    const file = await parseDriveFileResponse(response, true);
    return Result.isError(file) ? Result.err(file.error) : file;
  }

  private async fetchDrive(input: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(input, init);
    } catch {
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

function createMultipartBody(envelopeJson: string): string {
  const metadata = JSON.stringify({ name: PASSPORT_FILE_NAME, parents: ["appDataFolder"] });
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
  if (Result.isError(parsed)) return failure("invalid_file");
  return success(JSON.stringify({ v: parsed.value.v, iv: parsed.value.iv, ct: parsed.value.ct, url: parsed.value.url }));
}

async function parseDriveFileResponse(
  response: Response,
  requireTrashed = false,
): Promise<ResultType<PassportFileReference, { code: PassportFileStoreErrorCode }>> {
  const contents = await readBoundedText(response, MAXIMUM_DRIVE_RESPONSE_BYTES);
  if (contents === null || contents === "too_large") return Result.err({ code: "invalid_response" });

  const file = parseJsonContents(contents);
  if (!isDriveFile(file)) return Result.err({ code: "invalid_response" });
  if (!isNonEmptyString(file.id) || typeof file.name !== "string" || !isNonEmptyString(file.version)) {
    return Result.err({ code: "invalid_response" });
  }
  if (requireTrashed && typeof file.trashed !== "boolean") return Result.err({ code: "invalid_response" });
  if (file.name !== PASSPORT_FILE_NAME || file.trashed === true) {
    return Result.err({ code: requireTrashed ? "stale_file" : "invalid_response" });
  }
  return Result.ok({ storageId: file.id, revision: file.version });
}

function parseJsonContents(contents: string): unknown {
  try {
    return JSON.parse(contents);
  } catch {
    return null;
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
  if (status === 599) return "network_failed";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  return fallback;
}

function success<T>(value: T): PassportFileStoreResult<T> {
  return Result.ok(value);
}

function failure<T>(code: PassportFileStoreErrorCode): PassportFileStoreResult<T> {
  return Result.err({ code });
}
