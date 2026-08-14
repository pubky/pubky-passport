import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../../libs/logger/logger";
import {
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
  isNonEmptyString,
  mapDriveStatus,
  multipartBody,
  parseDriveFileList,
  readDriveJson,
  type DriveFile,
  type DriveFileList,
} from "./driveHttp";

/** Safe visible-copy failures that contain no credentials or recovery contents. */
type VisibleCopiesErrorCode =
  | "unauthorized"
  | "forbidden"
  | "network_failed"
  | "invalid_response"
  | "invalid_file"
  | "write_failed"
  | "delete_failed";

type VisibleCopiesResult<Success> = ResultType<Success, { code: VisibleCopiesErrorCode }>;
type FileReference = Readonly<{ storageId: string; revision: string }>;
type VisibleFolder = DriveFile & { id: string };
type VisibleFile = DriveFile & { id: string };

const VISIBLE_RECOVERY_FOLDER_NAME = "Pubky Passport";
const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const PUBKY_PUBLIC_KEY_DISPLAY_PATTERN = /^pubky[ybndrfg8ejkmcpqxot1uwisza345h769]{51}[yo]$/;
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const LIST_PAGE_SIZE = "100";
const MAXIMUM_LIST_PAGES = 100;

/**
 * Owns append-only visible-copy creation and detachment cleanup in Google Drive.
 *
 * Visible copies are separate from the authoritative `appDataFolder` file and
 * are never read for normal restoration. The access token remains scoped to this
 * concrete adapter and is never returned or persisted.
 */
export class GoogleDriveVisibleRecoveryCopies {
  constructor(
    private accessToken: string,
    private fetchImpl: typeof fetch,
  ) {}

  /**
   * Appends one encrypted `{pubky}.json` recovery copy and verifies its exact
   * created revision and parent folder. Existing same-name files are preserved.
   * An optional signal lets the caller cancel or deadline-bound the attempt.
   */
  async createVisibleRecoveryCopy(
    envelope: PassportFileEnvelopeV1,
    publicKeyDisplay: string,
    signal?: AbortSignal,
  ): Promise<VisibleCopiesResult<void>> {
    if (signal?.aborted) return failure("network_failed", "create_visible_copy");

    const serializedEnvelope = serializePassportFileEnvelope(envelope);
    if (serializedEnvelope === null) return failure("invalid_file", "serialize_envelope");
    const fileName = visibleRecoveryFileName(publicKeyDisplay);
    if (fileName === null) return failure("invalid_file", "visible_file_name");

    const token = this.getAccessToken();
    if (Result.isError(token)) return Result.err(token.error);
    if (signal?.aborted) return failure("network_failed", "create_visible_copy");

    const folder = await this.findOrCreateFolder(token.value, signal);
    if (Result.isError(folder)) return Result.err(folder.error);

    const response = await this.fetchVisible("create_visible_copy", uploadUrl(), {
      method: "POST",
      headers: {
        ...authorizationHeaders(token.value),
        "Content-Type": DRIVE_MULTIPART_CONTENT_TYPE,
      },
      body: multipartBody(serializedEnvelope, {
        name: fileName,
        parents: [folder.value],
      }),
      ...(signal ? { signal } : {}),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (!response.value.ok) {
      return failure(mapDriveStatus(response.value.status, "write_failed"), "create_visible_copy");
    }

    const created = await this.parseFileResponse(
      response.value,
      fileName,
      "parse_visible_copy_response",
    );
    if (Result.isError(created)) return Result.err(created.error);

    return this.verifyCreatedFile(
      token.value,
      folder.value,
      fileName,
      created.value,
      signal,
    );
  }

  /**
   * Processes every matching `{pubky}.json` file under accessible root
   * `Pubky Passport` folders and returns the number of successful or idempotent
   * deletions. Pagination is bounded and folder, file, parent, and ID metadata is
   * validated first.
   */
  async deleteVisibleRecoveryCopies(publicKeyDisplay: string): Promise<VisibleCopiesResult<{ deletedCount: number }>> {
    const fileName = visibleRecoveryFileName(publicKeyDisplay);
    if (fileName === null) return failure("invalid_file", "validate_file_name");

    const token = this.getAccessToken();
    if (Result.isError(token)) return Result.err(token.error);

    try {
      const folders = await this.listAll(
        token.value,
        folderListUrl,
        isExpectedFolder,
        "list_folders",
      );
      if (Result.isError(folders)) return Result.err(folders.error);

      let deletedCount = 0;
      for (const folder of folders.value) {
        const files = await this.listAll(
          token.value,
          (pageToken) => fileListUrl(folder.id, fileName, pageToken),
          (file): file is VisibleFile => isExpectedFile(file, folder.id, fileName),
          "list_files",
        );
        if (Result.isError(files)) return Result.err(files.error);

        for (const file of files.value) {
          const deleted = await this.deleteFile(token.value, file.id);
          if (Result.isError(deleted)) return Result.err(deleted.error);
          deletedCount += 1;
        }
      }

      return Result.ok({ deletedCount });
    } catch {
      return failure("network_failed", "delete_visible_copies");
    }
  }

  private getAccessToken(): VisibleCopiesResult<string> {
    return this.accessToken.length > 0
      ? Result.ok(this.accessToken)
      : failure("unauthorized", "access_token");
  }

  private async findOrCreateFolder(
    token: string,
    signal?: AbortSignal,
  ): Promise<VisibleCopiesResult<string>> {
    const located = await this.findSingleFolder(token, signal);
    if (Result.isError(located)) return Result.err(located.error);
    if (located.value !== null) return Result.ok(located.value);

    const response = await this.fetchVisible("create_folder", folderCreateUrl(), {
      method: "POST",
      headers: {
        ...authorizationHeaders(token),
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        name: VISIBLE_RECOVERY_FOLDER_NAME,
        mimeType: DRIVE_FOLDER_MIME_TYPE,
        parents: ["root"],
      }),
      ...(signal ? { signal } : {}),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (!response.value.ok) {
      return failure(mapDriveStatus(response.value.status, "write_failed"), "create_folder");
    }

    const created = await this.parseFolderResponse(response.value);
    if (Result.isError(created)) return Result.err(created.error);

    const checked = await this.findSingleFolder(token, signal);
    if (Result.isError(checked)) return Result.err(checked.error);
    return checked.value === created.value
      ? Result.ok(checked.value)
      : failure("write_failed", "verify_folder");
  }

  private async findSingleFolder(
    token: string,
    signal?: AbortSignal,
  ): Promise<VisibleCopiesResult<string | null>> {
    const response = await this.fetchVisible("list_folder", singleFolderListUrl(), {
      headers: authorizationHeaders(token),
      ...(signal ? { signal } : {}),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (!response.value.ok) {
      return failure(mapDriveStatus(response.value.status, "invalid_response"), "list_folder");
    }

    const list = await this.parseListResponse(response.value, "parse_folder_list_response");
    if (Result.isError(list)) return Result.err(list.error);
    if (list.value.files.length > 1 || list.value.nextPageToken !== undefined) {
      return failure("invalid_response", "parse_folder_list_response");
    }

    const folder = list.value.files[0];
    if (folder === undefined) return Result.ok(null);
    if (!isNonEmptyString(folder.id)
      || folder.name !== VISIBLE_RECOVERY_FOLDER_NAME
      || folder.mimeType !== DRIVE_FOLDER_MIME_TYPE) {
      return failure("invalid_response", "parse_folder_list_response");
    }
    return Result.ok(folder.id);
  }

  private async parseFolderResponse(response: Response): Promise<VisibleCopiesResult<string>> {
    const folder = await readDriveJson(response);
    if (!isDriveFile(folder)
      || !isNonEmptyString(folder.id)
      || folder.name !== VISIBLE_RECOVERY_FOLDER_NAME
      || folder.mimeType !== DRIVE_FOLDER_MIME_TYPE
      || folder.trashed !== false) {
      return failure("invalid_response", "parse_folder_response");
    }
    return Result.ok(folder.id);
  }

  private async parseFileResponse(
    response: Response,
    expectedName: string,
    operation: VisibleCopiesOperation,
  ): Promise<VisibleCopiesResult<FileReference>> {
    const file = await readDriveJson(response);
    if (!isDriveFile(file)
      || !isNonEmptyString(file.id)
      || file.name !== expectedName
      || !isNonEmptyString(file.version)
      || file.trashed === true) {
      return failure("invalid_response", operation);
    }
    return Result.ok({ storageId: file.id, revision: file.version });
  }

  private async verifyCreatedFile(
    token: string,
    folderId: string,
    fileName: string,
    expectedReference: FileReference,
    signal?: AbortSignal,
  ): Promise<VisibleCopiesResult<void>> {
    const response = await this.fetchVisible("verify_copy", metadataUrl(expectedReference.storageId), {
      headers: authorizationHeaders(token),
      ...(signal ? { signal } : {}),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (!response.value.ok) {
      return failure(mapDriveStatus(response.value.status, "invalid_response"), "verify_copy");
    }

    const file = await readDriveJson(response.value);
    if (!isDriveFile(file)
      || !isNonEmptyString(file.id)
      || file.name !== fileName
      || !isNonEmptyString(file.version)
      || file.trashed !== false
      || !Array.isArray(file.parents)
      || file.parents.length !== 1
      || file.parents[0] !== folderId
      || !sameReference({ storageId: file.id, revision: file.version }, expectedReference)) {
      return failure("invalid_response", "parse_copy_verification_response");
    }
    return Result.ok();
  }

  private async listAll<ExpectedFile extends DriveFile>(
    token: string,
    url: (pageToken?: string) => string,
    validate: (file: DriveFile) => file is ExpectedFile,
    operation: "list_folders" | "list_files",
  ): Promise<VisibleCopiesResult<ExpectedFile[]>> {
    const files: ExpectedFile[] = [];
    const seenPageTokens = new Set<string>();
    let pageToken: string | undefined;

    do {
      const response = await this.fetchVisible(operation, url(pageToken), {
        headers: authorizationHeaders(token),
      });
      if (Result.isError(response)) return Result.err(response.error);
      if (!response.value.ok) return deletionFailure(response.value.status, operation);

      const list = await this.parseListResponse(response.value, operation);
      if (Result.isError(list)) return Result.err(list.error);
      if (!list.value.files.every(validate)) return failure("invalid_response", operation);
      files.push(...list.value.files);

      pageToken = list.value.nextPageToken;
      if (pageToken && seenPageTokens.has(pageToken)) return failure("invalid_response", operation);
      if (pageToken && seenPageTokens.size >= MAXIMUM_LIST_PAGES) {
        return failure("invalid_response", operation);
      }
      if (pageToken) seenPageTokens.add(pageToken);
    } while (pageToken);

    return Result.ok(files);
  }

  private async deleteFile(token: string, fileId: string): Promise<VisibleCopiesResult<void>> {
    const response = await this.fetchVisible("delete_file", driveFileUrl(fileId), {
      method: "DELETE",
      headers: authorizationHeaders(token),
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (response.value.status === 404 || response.value.ok) return Result.ok();
    return deletionFailure(response.value.status, "delete_file");
  }

  private async parseListResponse(
    response: Response,
    operation: VisibleCopiesOperation,
  ): Promise<VisibleCopiesResult<DriveFileList>> {
    const list = parseDriveFileList(await readDriveJson(response));
    return list === null ? failure("invalid_response", operation) : Result.ok(list);
  }

  private async fetchVisible(
    operation: VisibleCopiesOperation,
    input: string,
    init: RequestInit,
  ): Promise<VisibleCopiesResult<Response>> {
    const response = await fetchDrive(this.fetchImpl, input, init);
    return response === null ? failure("network_failed", operation) : Result.ok(response);
  }
}

function singleFolderListUrl(): string {
  const params = new URLSearchParams({
    spaces: "drive",
    q: folderQuery(),
    fields: "nextPageToken,files(id,name,mimeType)",
    pageSize: "2",
    orderBy: "createdTime",
  });
  return `${DRIVE_FILES_URL}?${params.toString()}`;
}

function folderCreateUrl(): string {
  const params = new URLSearchParams({ fields: "id,name,mimeType,trashed" });
  return `${DRIVE_FILES_URL}?${params.toString()}`;
}

function uploadUrl(): string {
  const params = new URLSearchParams({ uploadType: "multipart", fields: "id,name,version" });
  return `${DRIVE_UPLOAD_FILES_URL}?${params.toString()}`;
}

function metadataUrl(fileId: string): string {
  const params = new URLSearchParams({ fields: "id,name,version,trashed,parents" });
  return `${driveFileUrl(fileId)}?${params.toString()}`;
}

function folderListUrl(pageToken?: string): string {
  return listUrl({
    q: folderQuery(),
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
    pageSize: LIST_PAGE_SIZE,
  });
  if (pageToken) params.set("pageToken", pageToken);
  return `${DRIVE_FILES_URL}?${params.toString()}`;
}

function folderQuery(): string {
  return `name = '${VISIBLE_RECOVERY_FOLDER_NAME}' and mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and 'root' in parents and trashed = false`;
}

function visibleRecoveryFileName(publicKeyDisplay: string): string | null {
  return PUBKY_PUBLIC_KEY_DISPLAY_PATTERN.test(publicKeyDisplay)
    ? `${publicKeyDisplay}.json`
    : null;
}

function isExpectedFolder(file: DriveFile): file is VisibleFolder {
  return typeof file.id === "string" && DRIVE_FILE_ID_PATTERN.test(file.id)
    && file.name === VISIBLE_RECOVERY_FOLDER_NAME
    && file.mimeType === DRIVE_FOLDER_MIME_TYPE
    && Array.isArray(file.parents) && file.parents.length === 1
    && typeof file.parents[0] === "string" && DRIVE_FILE_ID_PATTERN.test(file.parents[0])
    && file.trashed === false;
}

function isExpectedFile(file: DriveFile, folderId: string, fileName: string): file is VisibleFile {
  return typeof file.id === "string" && DRIVE_FILE_ID_PATTERN.test(file.id)
    && file.name === fileName
    && Array.isArray(file.parents) && file.parents.length === 1
    && file.parents[0] === folderId
    && file.trashed === false;
}

function sameReference(left: FileReference, right: FileReference): boolean {
  return left.storageId === right.storageId && left.revision === right.revision;
}

function deletionFailure<Success>(
  status: number,
  operation: VisibleCopiesOperation,
): VisibleCopiesResult<Success> {
  if (status === 401) return failure("unauthorized", operation);
  if (status === 403) return failure("forbidden", operation);
  return failure(status >= 500 ? "network_failed" : "delete_failed", operation);
}

function failure<Success>(
  code: VisibleCopiesErrorCode,
  operation: VisibleCopiesOperation,
): VisibleCopiesResult<Success> {
  LOGGER.warn("identity.google.visible_recovery_copies.failed", { operation, code });
  return Result.err({ code });
}

type VisibleCopiesOperation =
  | "access_token"
  | "serialize_envelope"
  | "visible_file_name"
  | "validate_file_name"
  | "list_folder"
  | "create_folder"
  | "verify_folder"
  | "create_visible_copy"
  | "verify_copy"
  | "parse_folder_list_response"
  | "parse_folder_response"
  | "parse_visible_copy_response"
  | "parse_copy_verification_response"
  | "list_folders"
  | "list_files"
  | "delete_file"
  | "delete_visible_copies";
