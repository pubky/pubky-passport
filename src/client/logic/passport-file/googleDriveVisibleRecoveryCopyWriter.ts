import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import { parsePassportFileEnvelope, type PassportFileEnvelopeV1 } from "./passportFileEnvelope";
import {
  createGoogleDriveMultipartBody,
  fetchGoogleDrive,
  GOOGLE_DRIVE_FILES_URL,
  GOOGLE_DRIVE_MULTIPART_CONTENT_TYPE,
  GOOGLE_DRIVE_UPLOAD_FILES_URL,
  googleDriveAuthorizationHeaders,
  isGoogleDriveFile,
  isNonEmptyString,
  mapGoogleDriveStatus,
  parseGoogleDriveFileList,
  readGoogleDriveJson,
  type GoogleDriveFile,
} from "./googleDriveHttp";
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
type VisibleRecoveryCopyResult<Success> = ResultType<Success, { code: VisibleRecoveryCopyErrorCode }>;
type VisibleFileReference = Readonly<{ storageId: string; revision: string }>;

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
    if (Result.isError(token)) return Result.err(token.error);
    if (signal?.aborted) return failure("network_failed", "create_visible_copy");
    const folder = await this.findOrCreateFolder(token.value, signal);
    if (Result.isError(folder)) return Result.err(folder.error);
    const response = await this.fetchDrive("create_visible_copy", uploadUrl(), {
      method: "POST",
      headers: {
        ...googleDriveAuthorizationHeaders(token.value),
        "Content-Type": GOOGLE_DRIVE_MULTIPART_CONTENT_TYPE,
      },
      body: createGoogleDriveMultipartBody(serializedEnvelope, {
        name: fileName,
        parents: [folder.value],
      }),
      ...(signal ? { signal } : {}),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (!response.value.ok) {
      return failure(mapGoogleDriveStatus(response.value.status, "write_failed"), "create_visible_copy");
    }

    const created = await parseFileResponse(response.value, fileName, "parse_visible_copy_response");
    if (Result.isError(created)) return Result.err(created.error);
    return this.verifyCreatedFile(token.value, folder.value, fileName, created.value, signal);
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
    if (Result.isError(located)) return Result.err(located.error);
    if (located.value !== null) return Result.ok(located.value);

    const response = await this.fetchDrive("create_visible_folder", metadataCreateUrl(), {
      method: "POST",
      headers: { ...googleDriveAuthorizationHeaders(token), "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        name: VISIBLE_RECOVERY_FOLDER_NAME,
        mimeType: DRIVE_FOLDER_MIME_TYPE,
        parents: ["root"],
      }),
      ...(signal ? { signal } : {}),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (!response.value.ok) {
      return failure(mapGoogleDriveStatus(response.value.status, "write_failed"), "create_visible_folder");
    }
    const created = await parseFolderResponse(response.value);
    if (Result.isError(created)) return Result.err(created.error);

    const checked = await this.listFolders(token, signal);
    if (Result.isError(checked)) return Result.err(checked.error);
    return checked.value === null || checked.value !== created.value
      ? failure("write_failed", "verify_visible_folder")
      : Result.ok(checked.value);
  }

  private async listFolders(token: string, signal?: AbortSignal): Promise<VisibleRecoveryCopyResult<string | null>> {
    const response = await this.fetchDrive("list_visible_folder", folderListUrl(), {
      headers: googleDriveAuthorizationHeaders(token),
      ...(signal ? { signal } : {}),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (!response.value.ok) {
      return failure(mapGoogleDriveStatus(response.value.status, "invalid_response"), "list_visible_folder");
    }
    const list = await parseListResponse(response.value, "parse_visible_folder_list_response");
    if (Result.isError(list)) return Result.err(list.error);
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
      headers: googleDriveAuthorizationHeaders(token),
      ...(signal ? { signal } : {}),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (!response.value.ok) {
      return failure(mapGoogleDriveStatus(response.value.status, "invalid_response"), "verify_visible_copy");
    }
    const parsed = await parseResponse(response.value, "parse_visible_copy_verification_response");
    if (Result.isError(parsed)) return Result.err(parsed.error);
    if (!isGoogleDriveFile(parsed.value)
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

  private async fetchDrive(
    operation: WriterOperation,
    input: string,
    init: RequestInit,
  ): Promise<VisibleRecoveryCopyResult<Response>> {
    const fetched = await fetchGoogleDrive(this.#fetch, input, init);
    return fetched.status === "received"
      ? Result.ok(fetched.response)
      : failure("network_failed", operation);
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
  return `${GOOGLE_DRIVE_FILES_URL}?${params.toString()}`;
}

function fileMetadataUrl(fileId: string): string {
  const params = new URLSearchParams({ fields: "id,name,version,trashed,parents" });
  return `${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?${params.toString()}`;
}

function metadataCreateUrl(): string {
  return `${GOOGLE_DRIVE_FILES_URL}?${new URLSearchParams({ fields: "id,name,mimeType,trashed" }).toString()}`;
}

function uploadUrl(): string {
  return `${GOOGLE_DRIVE_UPLOAD_FILES_URL}?${new URLSearchParams({ uploadType: "multipart", fields: "id,name,version" }).toString()}`;
}

async function parseFolderResponse(response: Response): Promise<VisibleRecoveryCopyResult<string>> {
  const parsed = await parseResponse(response, "parse_visible_folder_response");
  if (Result.isError(parsed)) return Result.err(parsed.error);
  if (!isGoogleDriveFile(parsed.value)
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
  if (Result.isError(parsed)) return Result.err(parsed.error);
  if (!isGoogleDriveFile(parsed.value)
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
): Promise<VisibleRecoveryCopyResult<{ files: GoogleDriveFile[]; nextPageToken?: string }>> {
  const parsed = await parseResponse(response, operation);
  if (Result.isError(parsed)) return Result.err(parsed.error);
  const list = parseGoogleDriveFileList(parsed.value);
  return list === null ? failure("invalid_response", operation) : Result.ok(list);
}

async function parseResponse(response: Response, operation: WriterOperation): Promise<VisibleRecoveryCopyResult<unknown>> {
  const parsed = await readGoogleDriveJson(response);
  return parsed.status === "parsed"
    ? Result.ok(parsed.value)
    : failure("invalid_response", operation);
}

function sameReference(left: VisibleFileReference, right: VisibleFileReference): boolean {
  return left.storageId === right.storageId && left.revision === right.revision;
}

function failure<Success>(code: VisibleRecoveryCopyErrorCode, operation: WriterOperation): VisibleRecoveryCopyResult<Success> {
  logFailure(operation, code);
  return Result.err({ code });
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
