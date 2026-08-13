import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../libs/logger/logger";
import {
  fetchGoogleDrive,
  GOOGLE_DRIVE_FILES_URL,
  googleDriveAuthorizationHeaders,
  parseGoogleDriveFileList,
  readGoogleDriveJson,
  type GoogleDriveFile,
} from "./googleDriveHttp";
import {
  DRIVE_FOLDER_MIME_TYPE,
  VISIBLE_RECOVERY_FOLDER_NAME,
  visibleRecoveryFileName,
} from "./googleDriveVisibleRecoveryCopy";

type VisibleRecoveryCopyDeletionErrorCode =
  | "unauthorized"
  | "forbidden"
  | "network_failed"
  | "invalid_response"
  | "invalid_file"
  | "delete_failed";

export type VisibleRecoveryCopyDeletionResult = ResultType<
  { deletedCount: number },
  { code: VisibleRecoveryCopyDeletionErrorCode }
>;

const PAGE_SIZE = "100";
const MAXIMUM_LIST_PAGES = 100;
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class GoogleDriveVisibleRecoveryCopyDeleter {
  readonly #fetch: typeof fetch;

  constructor(input: { fetch: typeof fetch }) {
    this.#fetch = input.fetch;
  }

  async deleteVisibleRecoveryCopies(
    driveAccessToken: string,
    publicKeyDisplay: string,
  ): Promise<VisibleRecoveryCopyDeletionResult> {
    const fileName = visibleRecoveryFileName(publicKeyDisplay);
    if (fileName === null) return failure("invalid_file", "validate_file_name");

    try {
      const folders = await this.listAll(driveAccessToken, folderListUrl, isExpectedFolder, "list_folders");
      if (Result.isError(folders)) return Result.err(folders.error);

      let deletedCount = 0;
      for (const folder of folders.value) {
        const files = await this.listAll(
          driveAccessToken,
          (pageToken) => fileListUrl(folder.id as string, fileName, pageToken),
          (file) => isExpectedFile(file, folder.id as string, fileName),
          "list_files",
        );
        if (Result.isError(files)) return Result.err(files.error);

        for (const file of files.value) {
          const deleted = await this.deleteFile(driveAccessToken, file.id as string);
          if (Result.isError(deleted)) return Result.err(deleted.error);
          deletedCount += 1;
        }
      }
      return Result.ok({ deletedCount });
    } catch {
      return failure("network_failed", "delete_visible_copies");
    }
  }

  private async listAll(
    token: string,
    url: (pageToken?: string) => string,
    validate: (file: GoogleDriveFile) => boolean,
    operation: "list_folders" | "list_files",
  ): Promise<ResultType<GoogleDriveFile[], { code: VisibleRecoveryCopyDeletionErrorCode }>> {
    const files: GoogleDriveFile[] = [];
    const seenPageTokens = new Set<string>();
    let pageToken: string | undefined;

    do {
      const response = await this.fetchDrive(operation, url(pageToken), {
        headers: googleDriveAuthorizationHeaders(token),
      });
      if (Result.isError(response)) return Result.err(response.error);
      if (!response.value.ok) return driveFailure(response.value.status, operation);
      const parsed = await parseListResponse(response.value, operation);
      if (Result.isError(parsed)) return Result.err(parsed.error);
      if (!parsed.value.files.every(validate)) return failure("invalid_response", operation);
      files.push(...parsed.value.files);
      pageToken = parsed.value.nextPageToken;
      if (pageToken && seenPageTokens.has(pageToken)) return failure("invalid_response", operation);
      if (pageToken && seenPageTokens.size >= MAXIMUM_LIST_PAGES) return failure("invalid_response", operation);
      if (pageToken) seenPageTokens.add(pageToken);
    } while (pageToken);

    return Result.ok(files);
  }

  private async deleteFile(
    token: string,
    fileId: string,
  ): Promise<ResultType<void, { code: VisibleRecoveryCopyDeletionErrorCode }>> {
    const response = await this.fetchDrive("delete_file", `${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: googleDriveAuthorizationHeaders(token),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (response.value.status === 404) return Result.ok(undefined);
    return response.value.ok
      ? Result.ok(undefined)
      : driveFailure(response.value.status, "delete_file");
  }

  private async fetchDrive(
    operation: DeletionOperation,
    input: string,
    init: RequestInit,
  ): Promise<ResultType<Response, { code: VisibleRecoveryCopyDeletionErrorCode }>> {
    const fetched = await fetchGoogleDrive(this.#fetch, input, init);
    return fetched.status === "received"
      ? Result.ok(fetched.response)
      : failure("network_failed", operation);
  }
}

function folderListUrl(pageToken?: string): string {
  return listUrl({
    q: `name = '${VISIBLE_RECOVERY_FOLDER_NAME}' and mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and 'root' in parents and trashed = false`,
    fields: "nextPageToken,files(id,name,mimeType,parents,trashed)",
  }, pageToken);
}

function fileListUrl(folderId: string, fileName: string, pageToken?: string): string {
  return listUrl({
    q: `name = '${fileName}' and '${folderId}' in parents and trashed = false`,
    fields: "nextPageToken,files(id,name,parents,trashed)",
  }, pageToken);
}

function listUrl(input: { q: string; fields: string }, pageToken?: string): string {
  const params = new URLSearchParams({
    spaces: "drive",
    q: input.q,
    fields: input.fields,
    pageSize: PAGE_SIZE,
  });
  if (pageToken) params.set("pageToken", pageToken);
  return `${GOOGLE_DRIVE_FILES_URL}?${params.toString()}`;
}

async function parseListResponse(
  response: Response,
  operation: "list_folders" | "list_files",
): Promise<ResultType<{ files: GoogleDriveFile[]; nextPageToken?: string }, { code: VisibleRecoveryCopyDeletionErrorCode }>> {
  const parsed = await readGoogleDriveJson(response);
  if (parsed.status === "invalid_response") return failure("invalid_response", operation);
  const list = parseGoogleDriveFileList(parsed.value);
  return list === null ? failure("invalid_response", operation) : Result.ok(list);
}

function isExpectedFolder(file: GoogleDriveFile): boolean {
  return typeof file.id === "string" && DRIVE_FILE_ID_PATTERN.test(file.id)
    && file.name === VISIBLE_RECOVERY_FOLDER_NAME
    && file.mimeType === DRIVE_FOLDER_MIME_TYPE
    && Array.isArray(file.parents) && file.parents.length === 1
    && typeof file.parents[0] === "string" && DRIVE_FILE_ID_PATTERN.test(file.parents[0])
    && file.trashed === false;
}

function isExpectedFile(file: GoogleDriveFile, folderId: string, fileName: string): boolean {
  return typeof file.id === "string" && DRIVE_FILE_ID_PATTERN.test(file.id)
    && file.name === fileName
    && Array.isArray(file.parents) && file.parents.length === 1 && file.parents[0] === folderId
    && file.trashed === false;
}

function driveFailure<Success>(status: number, operation: DeletionOperation): ResultType<Success, { code: VisibleRecoveryCopyDeletionErrorCode }> {
  switch (status) {
    case 401:
      return failure("unauthorized", operation);
    case 403:
      return failure("forbidden", operation);
    default:
      return failure(status >= 500 ? "network_failed" : "delete_failed", operation);
  }
}

function failure<Success>(
  code: VisibleRecoveryCopyDeletionErrorCode,
  operation: DeletionOperation,
): ResultType<Success, { code: VisibleRecoveryCopyDeletionErrorCode }> {
  LOGGER.warn("identity.google.visible_recovery_copy_deleter.failed", { operation, code });
  return Result.err({ code });
}

type DeletionOperation =
  | "validate_file_name"
  | "list_folders"
  | "list_files"
  | "delete_file"
  | "delete_visible_copies";
