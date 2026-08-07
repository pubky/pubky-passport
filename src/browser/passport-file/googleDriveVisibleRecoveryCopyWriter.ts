import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { readBoundedText } from "../../libs/http/boundedBody";
import { LOGGER } from "../../libs/logger/logger";
import { parsePassportFileEnvelope, type PassportFileEnvelopeV1 } from "./passportFileEnvelope";
import {
  DRIVE_FOLDER_MIME_TYPE,
  VISIBLE_RECOVERY_FOLDER_NAME,
  visibleRecoveryFileName,
} from "./googleDriveVisibleRecoveryCopy";

export type GoogleDriveVisibleRecoveryCopyWriterOptions = {
  accessTokenProvider: () => Promise<string | null | undefined>;
  fetch: typeof fetch;
};

type VisibleRecoveryCopyErrorCode =
  | "unauthorized"
  | "forbidden"
  | "network_failed"
  | "invalid_response"
  | "invalid_file"
  | "write_failed";
type VisibleRecoveryCopyResult<T> = ResultType<T, { code: VisibleRecoveryCopyErrorCode }>;
type VisibleFileReference = Readonly<{ storageId: string; revision: string }>;

type DriveFile = {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  trashed?: unknown;
  mimeType?: unknown;
  parents?: unknown;
};

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_FILES_URL = "https://www.googleapis.com/upload/drive/v3/files";
const MULTIPART_BOUNDARY = "pubky-passport-drive-boundary-v1";
const MAXIMUM_DRIVE_RESPONSE_BYTES = 16 * 1024;
const INVALID_JSON = Symbol("invalid_json");

export class GoogleDriveVisibleRecoveryCopyWriter {
  readonly #accessTokenProvider: () => Promise<string | null | undefined>;
  readonly #fetch: typeof fetch;

  constructor(options: GoogleDriveVisibleRecoveryCopyWriterOptions) {
    this.#accessTokenProvider = options.accessTokenProvider;
    this.#fetch = options.fetch;
  }

  async createVisibleRecoveryCopy(
    envelope: PassportFileEnvelopeV1,
    publicKeyDisplay: string,
    signal?: AbortSignal,
  ): Promise<VisibleRecoveryCopyResult<void>> {
    if (signal?.aborted) return failure("network_failed", "create_visible_copy");
    const parsed = parsePassportFileEnvelope(envelope);
    if (Result.isError(parsed)) return failure("invalid_file", "serialize_envelope");
    const serializedEnvelope = JSON.stringify({
      v: parsed.value.v,
      iv: parsed.value.iv,
      ct: parsed.value.ct,
      url: parsed.value.url,
    });
    const fileName = visibleRecoveryFileName(publicKeyDisplay);
    if (fileName === null) return failure("invalid_file", "visible_file_name");

    const token = await this.getAccessToken();
    if (Result.isError(token)) return propagateFailure(token.error);
    return this.createVisibleRecoveryCopyUnlocked(token.value, serializedEnvelope, fileName, signal);
  }

  private async createVisibleRecoveryCopyUnlocked(
    token: string,
    serializedEnvelope: string,
    fileName: string,
    signal?: AbortSignal,
  ): Promise<VisibleRecoveryCopyResult<void>> {
    if (signal?.aborted) return failure("network_failed", "create_visible_copy");
    const folder = await this.findOrCreateFolder(token, signal);
    if (Result.isError(folder)) return propagateFailure(folder.error);
    const response = await this.fetchDrive("create_visible_copy", uploadUrl(), {
      method: "POST",
      headers: {
        ...authorizationHeaders(token),
        "Content-Type": `multipart/related; boundary=${MULTIPART_BOUNDARY}`,
      },
      body: createMultipartBody(serializedEnvelope, fileName, folder.value),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return response.status === 599
      ? Result.err({ code: "network_failed" })
      : failure(mapDriveStatus(response.status, "write_failed"), "create_visible_copy");

    const created = await parseFileResponse(response, fileName, "parse_visible_copy_response");
    if (Result.isError(created)) return propagateFailure(created.error);
    return this.verifyCreatedFile(token, folder.value, fileName, created.value, signal);
  }

  private async getAccessToken(): Promise<VisibleRecoveryCopyResult<string>> {
    try {
      const token = await this.#accessTokenProvider();
      return typeof token === "string" && token.length > 0
        ? Result.ok(token)
        : failure("unauthorized", "access_token");
    } catch {
      return failure("unauthorized", "access_token");
    }
  }

  private async findOrCreateFolder(token: string, signal?: AbortSignal): Promise<VisibleRecoveryCopyResult<string>> {
    const located = await this.listFolders(token, signal);
    if (Result.isError(located)) return propagateFailure(located.error);
    if (located.value !== null) return Result.ok(located.value);

    const response = await this.fetchDrive("create_visible_folder", metadataCreateUrl(), {
      method: "POST",
      headers: { ...authorizationHeaders(token), "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        name: VISIBLE_RECOVERY_FOLDER_NAME,
        mimeType: DRIVE_FOLDER_MIME_TYPE,
        parents: ["root"],
      }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return response.status === 599
      ? Result.err({ code: "network_failed" })
      : failure(mapDriveStatus(response.status, "write_failed"), "create_visible_folder");
    const created = await parseFolderResponse(response);
    if (Result.isError(created)) return propagateFailure(created.error);

    const checked = await this.listFolders(token, signal);
    if (Result.isError(checked)) return propagateFailure(checked.error);
    return checked.value === null || checked.value !== created.value
      ? failure("write_failed", "verify_visible_folder")
      : Result.ok(checked.value);
  }

  private async listFolders(token: string, signal?: AbortSignal): Promise<VisibleRecoveryCopyResult<string | null>> {
    const response = await this.fetchDrive("list_visible_folder", folderListUrl(), {
      headers: authorizationHeaders(token),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return response.status === 599
      ? Result.err({ code: "network_failed" })
      : failure(mapDriveStatus(response.status, "invalid_response"), "list_visible_folder");
    const list = await parseListResponse(response, "parse_visible_folder_list_response");
    if (Result.isError(list)) return propagateFailure(list.error);
    if (list.value.files.length > 1 || list.value.nextPageToken !== undefined) {
      return failure("invalid_response", "parse_visible_folder_list_response");
    }
    const file = list.value.files[0];
    if (file === undefined) return Result.ok(null);
    if (!isNonEmptyString(file.id)
      || file.name !== VISIBLE_RECOVERY_FOLDER_NAME
      || file.mimeType !== DRIVE_FOLDER_MIME_TYPE) {
      return failure("invalid_response", "parse_visible_folder_list_response");
    }
    return Result.ok(file.id);
  }

  private async verifyCreatedFile(
    token: string,
    folderId: string,
    fileName: string,
    expectedReference: VisibleFileReference,
    signal?: AbortSignal,
  ): Promise<VisibleRecoveryCopyResult<void>> {
    const response = await this.fetchDrive("verify_visible_copy", fileMetadataUrl(expectedReference.storageId), {
      headers: authorizationHeaders(token),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return response.status === 599
      ? Result.err({ code: "network_failed" })
      : failure(mapDriveStatus(response.status, "invalid_response"), "verify_visible_copy");
    const parsed = await parseResponse(response, "parse_visible_copy_verification_response");
    if (Result.isError(parsed)) return propagateFailure(parsed.error);
    if (!isDriveFile(parsed.value)
      || !isNonEmptyString(parsed.value.id)
      || parsed.value.name !== fileName
      || !isNonEmptyString(parsed.value.version)
      || parsed.value.trashed !== false
      || !Array.isArray(parsed.value.parents)
      || parsed.value.parents.length !== 1
      || parsed.value.parents[0] !== folderId
      || !sameReference({ storageId: parsed.value.id, revision: parsed.value.version }, expectedReference)) {
      return failure("invalid_response", "parse_visible_copy_verification_response");
    }
    return Result.ok(undefined);
  }

  private async fetchDrive(operation: WriterOperation, input: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(input, init);
    } catch {
      logFailure(operation, "network_failed");
      return new Response(null, { status: 599 });
    }
  }
}

function folderListUrl(): string {
  const params = new URLSearchParams({
    spaces: "drive",
    q: `name = '${VISIBLE_RECOVERY_FOLDER_NAME}' and mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and 'root' in parents and trashed = false`,
    fields: "nextPageToken,files(id,name,mimeType)",
    pageSize: "2",
    orderBy: "createdTime",
  });
  return `${DRIVE_FILES_URL}?${params.toString()}`;
}

function fileMetadataUrl(fileId: string): string {
  const params = new URLSearchParams({ fields: "id,name,version,trashed,parents" });
  return `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?${params.toString()}`;
}

function metadataCreateUrl(): string {
  return `${DRIVE_FILES_URL}?${new URLSearchParams({ fields: "id,name,mimeType,trashed" }).toString()}`;
}

function uploadUrl(): string {
  return `${DRIVE_UPLOAD_FILES_URL}?${new URLSearchParams({ uploadType: "multipart", fields: "id,name,version" }).toString()}`;
}

function authorizationHeaders(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function createMultipartBody(envelope: string, name: string, folderId: string): string {
  return [
    `--${MULTIPART_BOUNDARY}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({ name, parents: [folderId] }),
    `--${MULTIPART_BOUNDARY}`,
    "Content-Type: application/json",
    "",
    envelope,
    `--${MULTIPART_BOUNDARY}--`,
    "",
  ].join("\r\n");
}

async function parseFolderResponse(response: Response): Promise<VisibleRecoveryCopyResult<string>> {
  const parsed = await parseResponse(response, "parse_visible_folder_response");
  if (Result.isError(parsed)) return propagateFailure(parsed.error);
  if (!isDriveFile(parsed.value)
    || !isNonEmptyString(parsed.value.id)
    || parsed.value.name !== VISIBLE_RECOVERY_FOLDER_NAME
    || parsed.value.mimeType !== DRIVE_FOLDER_MIME_TYPE
    || parsed.value.trashed !== false) {
    return failure("invalid_response", "parse_visible_folder_response");
  }
  return Result.ok(parsed.value.id);
}

async function parseFileResponse(
  response: Response,
  expectedName: string,
  operation: WriterOperation,
): Promise<VisibleRecoveryCopyResult<VisibleFileReference>> {
  const parsed = await parseResponse(response, operation);
  if (Result.isError(parsed)) return propagateFailure(parsed.error);
  if (!isDriveFile(parsed.value)
    || !isNonEmptyString(parsed.value.id)
    || parsed.value.name !== expectedName
    || !isNonEmptyString(parsed.value.version)
    || parsed.value.trashed === true) {
    return failure("invalid_response", operation);
  }
  return Result.ok({ storageId: parsed.value.id, revision: parsed.value.version });
}

async function parseListResponse(
  response: Response,
  operation: WriterOperation,
): Promise<VisibleRecoveryCopyResult<{ files: DriveFile[]; nextPageToken?: string }>> {
  const parsed = await parseResponse(response, operation);
  if (Result.isError(parsed)) return propagateFailure(parsed.error);
  if (!isDriveListResponse(parsed.value)) return failure("invalid_response", operation);
  return Result.ok(parsed.value);
}

async function parseResponse(response: Response, operation: WriterOperation): Promise<VisibleRecoveryCopyResult<unknown>> {
  const contents = await readBoundedText(response, MAXIMUM_DRIVE_RESPONSE_BYTES);
  if (contents === null || contents === "too_large") return failure("invalid_response", operation);
  const parsed = parseJson(contents, operation);
  return parsed === INVALID_JSON ? Result.err({ code: "invalid_response" }) : Result.ok(parsed);
}

function parseJson(contents: string, operation: WriterOperation): unknown {
  try {
    return JSON.parse(contents);
  } catch {
    logFailure(operation, "invalid_response");
    return INVALID_JSON;
  }
}

function isDriveListResponse(value: unknown): value is { files: DriveFile[]; nextPageToken?: string } {
  if (!value || typeof value !== "object") return false;
  const response = value as { files?: unknown; nextPageToken?: unknown };
  return Array.isArray(response.files)
    && response.files.every(isDriveFile)
    && (response.nextPageToken === undefined || typeof response.nextPageToken === "string");
}

function isDriveFile(value: unknown): value is DriveFile {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function sameReference(left: VisibleFileReference, right: VisibleFileReference): boolean {
  return left.storageId === right.storageId && left.revision === right.revision;
}

function mapDriveStatus(status: number, fallback: VisibleRecoveryCopyErrorCode): VisibleRecoveryCopyErrorCode {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    default:
      return fallback;
  }
}

function failure<T>(code: VisibleRecoveryCopyErrorCode, operation: WriterOperation): VisibleRecoveryCopyResult<T> {
  logFailure(operation, code);
  return Result.err({ code });
}

function propagateFailure<T>(error: { code: VisibleRecoveryCopyErrorCode }): VisibleRecoveryCopyResult<T> {
  return Result.err(error);
}

function logFailure(operation: WriterOperation, code: VisibleRecoveryCopyErrorCode): void {
  LOGGER.warn("identity.google.visible_recovery_copy_writer.failed", { operation, code });
}

type WriterOperation =
  | "access_token"
  | "serialize_envelope"
  | "visible_file_name"
  | "list_visible_folder"
  | "create_visible_folder"
  | "verify_visible_folder"
  | "create_visible_copy"
  | "verify_visible_copy"
  | "parse_visible_folder_list_response"
  | "parse_visible_folder_response"
  | "parse_visible_copy_response"
  | "parse_visible_copy_verification_response";
