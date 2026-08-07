import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { readBoundedText } from "../../libs/http/boundedBody";
import { LOGGER } from "../../libs/logger/logger";
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

type DriveFile = {
  id?: unknown;
  name?: unknown;
  mimeType?: unknown;
  parents?: unknown;
  trashed?: unknown;
};

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const MAXIMUM_DRIVE_RESPONSE_BYTES = 16 * 1024;
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
    validate: (file: DriveFile) => boolean,
    operation: "list_folders" | "list_files",
  ): Promise<ResultType<DriveFile[], { code: VisibleRecoveryCopyDeletionErrorCode }>> {
    const files: DriveFile[] = [];
    const seenPageTokens = new Set<string>();
    let pageToken: string | undefined;

    do {
      const response = await this.fetchDrive(url(pageToken), {
        headers: authorizationHeaders(token),
      });
      if (!response.ok) return driveFailure(response.status, operation);
      const parsed = await parseListResponse(response, operation);
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
    const response = await this.fetchDrive(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: authorizationHeaders(token),
    });
    if (response.status === 404) return Result.ok(undefined);
    return response.ok ? Result.ok(undefined) : driveFailure(response.status, "delete_file");
  }

  private async fetchDrive(input: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(input, init);
    } catch {
      return new Response(null, { status: 599 });
    }
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
  return `${DRIVE_FILES_URL}?${params.toString()}`;
}

async function parseListResponse(
  response: Response,
  operation: "list_folders" | "list_files",
): Promise<ResultType<{ files: DriveFile[]; nextPageToken?: string }, { code: VisibleRecoveryCopyDeletionErrorCode }>> {
  const contents = await readBoundedText(response, MAXIMUM_DRIVE_RESPONSE_BYTES);
  if (contents === null || contents === "too_large") return failure("invalid_response", operation);
  let value: unknown;
  try { value = JSON.parse(contents); } catch { return failure("invalid_response", operation); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return failure("invalid_response", operation);
  const list = value as { files?: unknown; nextPageToken?: unknown };
  if (!Array.isArray(list.files)
    || !list.files.every(isDriveFile)
    || (list.nextPageToken !== undefined && typeof list.nextPageToken !== "string")) {
    return failure("invalid_response", operation);
  }
  return Result.ok({
    files: list.files,
    ...(typeof list.nextPageToken === "string" ? { nextPageToken: list.nextPageToken } : {}),
  });
}

function isExpectedFolder(file: DriveFile): boolean {
  return typeof file.id === "string" && DRIVE_FILE_ID_PATTERN.test(file.id)
    && file.name === VISIBLE_RECOVERY_FOLDER_NAME
    && file.mimeType === DRIVE_FOLDER_MIME_TYPE
    && Array.isArray(file.parents) && file.parents.length === 1
    && typeof file.parents[0] === "string" && DRIVE_FILE_ID_PATTERN.test(file.parents[0])
    && file.trashed === false;
}

function isExpectedFile(file: DriveFile, folderId: string, fileName: string): boolean {
  return typeof file.id === "string" && DRIVE_FILE_ID_PATTERN.test(file.id)
    && file.name === fileName
    && Array.isArray(file.parents) && file.parents.length === 1 && file.parents[0] === folderId
    && file.trashed === false;
}

function isDriveFile(value: unknown): value is DriveFile {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function authorizationHeaders(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function driveFailure<T>(status: number, operation: DeletionOperation): ResultType<T, { code: VisibleRecoveryCopyDeletionErrorCode }> {
  if (status === 401) return failure("unauthorized", operation);
  if (status === 403) return failure("forbidden", operation);
  if (status === 599) return failure("network_failed", operation);
  return failure(status >= 500 ? "network_failed" : "delete_failed", operation);
}

function failure<T>(
  code: VisibleRecoveryCopyDeletionErrorCode,
  operation: DeletionOperation,
): ResultType<T, { code: VisibleRecoveryCopyDeletionErrorCode }> {
  LOGGER.warn("identity.google.visible_recovery_copy_deleter.failed", { operation, code });
  return Result.err({ code });
}

type DeletionOperation =
  | "validate_file_name"
  | "list_folders"
  | "list_files"
  | "delete_file"
  | "delete_visible_copies";
