import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { PassportFileEnvelopeV1 } from "../../features/passport-file/passportFile";
import {
  parsePassportFileContents,
  parsePassportFileEnvelope,
  type PassportFileUrlOptions,
} from "../../features/passport-file/parsePassportFile";
import { readBoundedText } from "../../libs/security/boundedBody";
import type {
  PassportFileReadResult,
  PassportFileReference,
  PassportFileStore,
  PassportFileStoreErrorCode,
  PassportFileStoreResult,
} from "./ports";

export type GoogleDriveAccessTokenProvider = () => Promise<string | null | undefined>;

export type PassportFileCreateLockManager = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

export type GoogleDrivePassportFileRepositoryOptions = PassportFileUrlOptions & {
  accessTokenProvider: GoogleDriveAccessTokenProvider;
  fetch: typeof fetch;
  lockManager?: PassportFileCreateLockManager | null;
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

const driveFilesUrl = "https://www.googleapis.com/drive/v3/files";
const driveUploadFilesUrl = "https://www.googleapis.com/upload/drive/v3/files";
const passportFileName = "passport.json";
const multipartBoundary = "pubky-passport-drive-boundary-v1";
const maximumPassportFileBytes = 16 * 1024;
const maximumDriveResponseBytes = 16 * 1024;
const createPassportFileLockName = "pubky-passport:google-drive:passport-file:create:v1";

export class GoogleDrivePassportFileRepository implements PassportFileStore {
  private readonly accessTokenProvider: GoogleDriveAccessTokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly lockManager: PassportFileCreateLockManager | null;
  private readonly urlOptions: PassportFileUrlOptions;

  constructor(options: GoogleDrivePassportFileRepositoryOptions) {
    this.accessTokenProvider = options.accessTokenProvider;
    this.fetchImpl = options.fetch;
    this.lockManager = options.lockManager === undefined ? browserLockManager() : options.lockManager;
    this.urlOptions = options.allowLocalhostHttp === undefined ? {} : { allowLocalhostHttp: options.allowLocalhostHttp };
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

    const contents = await readBoundedText(response, maximumPassportFileBytes);
    if (contents === "too_large") return failure("invalid_file");
    if (contents === null) return failure("invalid_response");

    const parsed = parsePassportFileContents(contents, this.urlOptions);
    if (Result.isError(parsed)) return failure("invalid_file");

    const revalidated = await this.readExactMetadata(token.value, located.value.reference.storageId);
    if (Result.isError(revalidated)) {
      return failure(revalidated.error.code === "exact_file_missing" ? "stale_file" : revalidated.error.code);
    }
    if (!sameReference(revalidated.value, located.value.reference)) return failure("stale_file");

    return success({ status: "found", envelope: parsed.value, reference: located.value.reference });
  }

  async createPassportFile(input: { envelope: PassportFileEnvelopeV1 }): Promise<PassportFileStoreResult<PassportFileReference>> {
    const serializedEnvelope = serializeEnvelope(input.envelope, this.urlOptions);
    if (Result.isError(serializedEnvelope)) return failure(serializedEnvelope.error.code);

    const token = await this.getAccessToken();
    if (Result.isError(token)) return failure(token.error.code);

    const create = () => this.createPassportFileUnlocked(token.value, serializedEnvelope.value);
    if (this.lockManager === null) return create();

    try {
      return await this.lockManager.request(createPassportFileLockName, create);
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
        "Content-Type": `multipart/related; boundary=${multipartBoundary}`,
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

  async deletePassportFile(input: { reference: PassportFileReference }): Promise<PassportFileStoreResult<void>> {
    const token = await this.getAccessToken();
    if (Result.isError(token)) return failure(token.error.code);

    const current = await this.readExactMetadata(token.value, input.reference.storageId);
    if (Result.isError(current)) {
      return current.error.code === "exact_file_missing" ? success(undefined) : failure(current.error.code);
    }
    if (!sameReference(current.value, input.reference)) return failure("stale_file");

    const response = await this.fetchDrive(deleteUrl(input.reference.storageId), {
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

    const contents = await readBoundedText(response, maximumDriveResponseBytes);
    if (contents === null || contents === "too_large") return failure("invalid_response");

    const list = parseJsonContents(contents);
    if (!isDriveListResponse(list)) return failure("invalid_response");

    const files = list.files.filter((file): file is { id: string; name: string; version: string } => (
      isNonEmptyString(file.id)
      && typeof file.name === "string"
      && isNonEmptyString(file.version)
      && file.name === passportFileName
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

function browserLockManager(): PassportFileCreateLockManager | null {
  if (typeof navigator === "undefined" || navigator.locks === undefined) return null;
  return navigator.locks;
}

function listUrl(): string {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name = '${passportFileName}' and trashed = false`,
    fields: "nextPageToken,files(id,name,version)",
    pageSize: "2",
  });
  return `${driveFilesUrl}?${params.toString()}`;
}

function createUrl(): string {
  const params = new URLSearchParams({ uploadType: "multipart", fields: "id,name,version" });
  return `${driveUploadFilesUrl}?${params.toString()}`;
}

function mediaReadUrl(fileId: string): string {
  return `${driveFilesUrl}/${encodeURIComponent(fileId)}?alt=media`;
}

function metadataUrl(fileId: string): string {
  const params = new URLSearchParams({ fields: "id,name,version,trashed" });
  return `${driveFilesUrl}/${encodeURIComponent(fileId)}?${params.toString()}`;
}

function deleteUrl(fileId: string): string {
  return `${driveFilesUrl}/${encodeURIComponent(fileId)}`;
}

function authorizationHeaders(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function createMultipartBody(envelopeJson: string): string {
  const metadata = JSON.stringify({ name: passportFileName, parents: ["appDataFolder"] });
  return [
    `--${multipartBoundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    metadata,
    `--${multipartBoundary}`,
    "Content-Type: application/json",
    "",
    envelopeJson,
    `--${multipartBoundary}--`,
    "",
  ].join("\r\n");
}

function serializeEnvelope(
  envelope: PassportFileEnvelopeV1,
  options: PassportFileUrlOptions,
): PassportFileStoreResult<string> {
  const parsed = parsePassportFileEnvelope(envelope, options);
  if (Result.isError(parsed)) return failure("invalid_file");
  return success(JSON.stringify({ v: parsed.value.v, iv: parsed.value.iv, ct: parsed.value.ct, url: parsed.value.url }));
}

async function parseDriveFileResponse(
  response: Response,
  requireTrashed = false,
): Promise<ResultType<PassportFileReference, { code: PassportFileStoreErrorCode }>> {
  const contents = await readBoundedText(response, maximumDriveResponseBytes);
  if (contents === null || contents === "too_large") return Result.err({ code: "invalid_response" });

  const file = parseJsonContents(contents);
  if (!isDriveFile(file)) return Result.err({ code: "invalid_response" });
  if (!isNonEmptyString(file.id) || typeof file.name !== "string" || !isNonEmptyString(file.version)) {
    return Result.err({ code: "invalid_response" });
  }
  if (requireTrashed && typeof file.trashed !== "boolean") return Result.err({ code: "invalid_response" });
  if (file.name !== passportFileName || file.trashed === true) {
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
