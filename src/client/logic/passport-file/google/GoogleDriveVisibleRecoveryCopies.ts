import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "../../../../libs/logger/logger";
import type { CodedFailure } from "../../../../libs/result";
import { isPubkyPublicIdentity, type PubkyPublicIdentity } from "../../pubky/pubkyIdentityKey";
import { serializePassportFileEnvelope, type PassportFileEnvelope } from "../passportFileEnvelope";
import {
  authorizationHeaders,
  createDriveHttpResponseFailure,
  DRIVE_FILES_URL,
  DRIVE_MULTIPART_CONTENT_TYPE,
  DRIVE_UPLOAD_FILES_URL,
  driveFileUrl,
  fetchDrive,
  isDriveFile,
  isNonEmptyString,
  mapDriveStatus,
  multipartBody,
  parseDriveFileRevision,
  parseDriveFileList,
  readDriveJson,
  sameDriveFileIdentity,
  type DriveFile,
  type DriveFileList,
  type DriveFileRevision,
} from "./driveHttp";

/** Stable visible-copy failure codes. */
type VisibleCopiesErrorCode =
  | "unauthorized"
  | "forbidden"
  | "network_failed"
  | "invalid_response"
  | "invalid_file"
  | "write_failed"
  | "delete_failed";

type VisibleCopiesFailure = CodedFailure<VisibleCopiesErrorCode> & { httpStatus?: number };
type VisibleCopiesResult<Success> = ResultType<Success, VisibleCopiesFailure>;
type VisibleFolder = DriveFile & { id: string };
type VisibleFile = DriveFile & { id: string };
type RequestLock = <LockResult>(
  name: string,
  callback: () => Promise<LockResult>,
) => Promise<LockResult>;

const VISIBLE_RECOVERY_FOLDER_NAME = "Pubky Passport";
const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const LIST_PAGE_SIZE = "25";
const MAXIMUM_LIST_PAGES = 100;
const CREATE_VISIBLE_FOLDER_LOCK_NAME = "pubky-passport:google-drive:visible-folder:create:v1";

/**
 * Owns append-only visible-copy creation and detachment cleanup in Google Drive.
 *
 * Visible copies are separate from the authoritative `appDataFolder` file and
 * are never read for normal restoration. The access token remains scoped to this
 * concrete adapter and is never returned or persisted.
 */
export class GoogleDriveVisibleRecoveryCopies {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  /**
   * Appends one encrypted `{pubky}.json` recovery copy and verifies its created
   * file ID, name, and parent folder. Existing same-name files are preserved.
   * The signal lets the caller cancel or deadline-bound the attempt.
   */
  async createVisibleRecoveryCopy(
    envelope: PassportFileEnvelope,
    publicIdentity: PubkyPublicIdentity,
    signal: AbortSignal,
  ): Promise<VisibleCopiesResult<void>> {
    if (signal.aborted) {
      LOGGER.warn("identity.google.visible_recovery_copies.failed", {
        operation: "create_visible_copy",
        code: "network_failed",
      });
      return Result.err({ code: "network_failed" });
    }

    const serializedEnvelope = serializePassportFileEnvelope(envelope);
    if (serializedEnvelope === null) {
      LOGGER.warn("identity.google.visible_recovery_copies.failed", {
        operation: "serialize_envelope",
        code: "invalid_file",
      });
      return Result.err({ code: "invalid_file" });
    }
    const fileName = visibleRecoveryFileName(publicIdentity);
    if (fileName === null) {
      LOGGER.warn("identity.google.visible_recovery_copies.failed", {
        operation: "visible_file_name",
        code: "invalid_file",
      });
      return Result.err({ code: "invalid_file" });
    }

    const token = this.getAccessToken();
    if (Result.isError(token)) return Result.err(token.error);
    if (signal.aborted) {
      LOGGER.warn("identity.google.visible_recovery_copies.failed", {
        operation: "create_visible_copy",
        code: "network_failed",
      });
      return Result.err({ code: "network_failed" });
    }

    const folder = await this.findOrCreateFolderWithLock(token.value, signal);
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
      signal,
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (!response.value.ok) {
      return this.httpResponseFailure(
        response.value,
        "create_visible_copy",
        mapDriveStatus(response.value.status, "write_failed"),
      );
    }

    const created = await this.parseFileResponse(
      response.value,
      fileName,
      "parse_visible_copy_response",
    );
    if (Result.isError(created)) return Result.err(created.error);

    return this.verifyCreatedFile(token.value, folder.value, fileName, created.value, signal);
  }

  /**
   * Processes every matching `{pubky}.json` file under accessible root
   * `Pubky Passport` folder. Pagination is bounded and folder, file, parent, and
   * ID metadata is validated before deletion.
   */
  async deleteVisibleRecoveryCopies(
    publicIdentity: PubkyPublicIdentity,
  ): Promise<VisibleCopiesResult<void>> {
    const fileName = visibleRecoveryFileName(publicIdentity);
    if (fileName === null) {
      LOGGER.warn("identity.google.visible_recovery_copies.failed", {
        operation: "validate_file_name",
        code: "invalid_file",
      });
      return Result.err({ code: "invalid_file" });
    }

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
        }
      }

      return Result.ok();
    } catch (cause) {
      LOGGER.warn("identity.google.visible_recovery_copies.failed", {
        operation: "delete_visible_copies",
        code: "network_failed",
        ...safeErrorLogFields(cause),
      });
      return Result.err({ code: "network_failed", cause });
    }
  }

  private getAccessToken(): VisibleCopiesResult<string> {
    if (this.accessToken.length > 0) return Result.ok(this.accessToken);
    LOGGER.warn("identity.google.visible_recovery_copies.failed", {
      operation: "access_token",
      code: "unauthorized",
    });
    return Result.err({ code: "unauthorized" });
  }

  private async findOrCreateFolderWithLock(
    token: string,
    signal: AbortSignal,
  ): Promise<VisibleCopiesResult<string>> {
    const create = () => this.findOrCreateFolder(token, signal);
    const requestLock = browserRequestLock();
    if (requestLock === null) return create();
    try {
      return await requestLock(CREATE_VISIBLE_FOLDER_LOCK_NAME, create);
    } catch (cause) {
      LOGGER.warn("identity.google.visible_recovery_copies.failed", {
        operation: "create_folder_lock",
        code: "write_failed",
        ...safeErrorLogFields(cause),
      });
      return Result.err({ code: "write_failed", cause });
    }
  }

  private async findOrCreateFolder(
    token: string,
    signal: AbortSignal,
  ): Promise<VisibleCopiesResult<string>> {
    const located = await this.findCanonicalFolder(token, signal);
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
      signal,
    });
    if (Result.isError(response)) return Result.err(response.error);
    if (!response.value.ok) {
      return this.httpResponseFailure(
        response.value,
        "create_folder",
        mapDriveStatus(response.value.status, "write_failed"),
      );
    }

    const created = await this.parseFolderResponse(response.value);
    if (Result.isError(created)) return Result.err(created.error);

    const checked = await this.findCanonicalFolder(token, signal);
    if (Result.isError(checked)) return Result.err(checked.error);
    if (checked.value !== null) return Result.ok(checked.value);
    LOGGER.warn("identity.google.visible_recovery_copies.failed", {
      operation: "verify_folder",
      code: "write_failed",
    });
    return Result.err({ code: "write_failed" });
  }

  private async findCanonicalFolder(
    token: string,
    signal: AbortSignal,
  ): Promise<VisibleCopiesResult<string | null>> {
    const folderIds: string[] = [];
    const seenPageTokens = new Set<string>();
    let pageToken: string | undefined;
    let pagesRead = 0;
    do {
      if (pagesRead >= MAXIMUM_LIST_PAGES) return invalidFolderList();
      pagesRead += 1;
      const response = await this.fetchVisible("list_folder", folderLookupUrl(pageToken), {
        headers: authorizationHeaders(token),
        signal,
      });
      if (Result.isError(response)) return Result.err(response.error);
      if (!response.value.ok) {
        return this.httpResponseFailure(
          response.value,
          "list_folder",
          mapDriveStatus(response.value.status, "invalid_response"),
        );
      }

      const list = await this.parseListResponse(response.value, "parse_folder_list_response");
      if (Result.isError(list)) return Result.err(list.error);
      for (const folder of list.value.files) {
        if (
          !isNonEmptyString(folder.id) ||
          folder.name !== VISIBLE_RECOVERY_FOLDER_NAME ||
          folder.mimeType !== DRIVE_FOLDER_MIME_TYPE
        )
          return invalidFolderList();
        folderIds.push(folder.id);
      }
      pageToken = list.value.nextPageToken;
      if (pageToken && seenPageTokens.has(pageToken)) return invalidFolderList();
      if (pageToken) seenPageTokens.add(pageToken);
    } while (pageToken);

    folderIds.sort();
    return Result.ok(folderIds[0] ?? null);
  }

  private async parseFolderResponse(response: Response): Promise<VisibleCopiesResult<string>> {
    const folder = await readDriveJson(response);
    if (Result.isError(folder)) {
      LOGGER.warn("identity.google.visible_recovery_copies.failed", {
        operation: "parse_folder_response",
        code: "invalid_response",
        ...safeErrorLogFields(folder.error.cause),
      });
      return Result.err({ code: "invalid_response", cause: folder.error.cause });
    }
    if (
      !isDriveFile(folder.value) ||
      !isNonEmptyString(folder.value.id) ||
      folder.value.name !== VISIBLE_RECOVERY_FOLDER_NAME ||
      folder.value.mimeType !== DRIVE_FOLDER_MIME_TYPE ||
      folder.value.trashed !== false
    ) {
      LOGGER.warn("identity.google.visible_recovery_copies.failed", {
        operation: "parse_folder_response",
        code: "invalid_response",
      });
      return Result.err({ code: "invalid_response" });
    }
    return Result.ok(folder.value.id);
  }

  private async parseFileResponse(
    response: Response,
    expectedName: string,
    operation: VisibleCopiesOperation,
  ): Promise<VisibleCopiesResult<DriveFileRevision>> {
    const file = await readDriveJson(response);
    if (Result.isError(file)) {
      LOGGER.warn("identity.google.visible_recovery_copies.failed", {
        operation,
        code: "invalid_response",
        ...safeErrorLogFields(file.error.cause),
      });
      return Result.err({ code: "invalid_response", cause: file.error.cause });
    }
    if (!isDriveFile(file.value)) {
      LOGGER.warn("identity.google.visible_recovery_copies.failed", {
        operation,
        code: "invalid_response",
      });
      return Result.err({ code: "invalid_response" });
    }

    const reference = parseDriveFileRevision(file.value);
    if (reference === null || file.value.name !== expectedName || file.value.trashed === true) {
      LOGGER.warn("identity.google.visible_recovery_copies.failed", {
        operation,
        code: "invalid_response",
      });
      return Result.err({ code: "invalid_response" });
    }
    return Result.ok(reference);
  }

  private async verifyCreatedFile(
    token: string,
    folderId: string,
    fileName: string,
    expectedReference: DriveFileRevision,
    signal: AbortSignal,
  ): Promise<VisibleCopiesResult<void>> {
    const response = await this.fetchVisible(
      "verify_copy",
      metadataUrl(expectedReference.storageId),
      {
        headers: authorizationHeaders(token),
        signal,
      },
    );
    if (Result.isError(response)) return Result.err(response.error);
    if (!response.value.ok) {
      return this.httpResponseFailure(
        response.value,
        "verify_copy",
        mapDriveStatus(response.value.status, "invalid_response"),
      );
    }

    const file = await readDriveJson(response.value);
    if (Result.isError(file)) {
      LOGGER.warn("identity.google.visible_recovery_copies.failed", {
        operation: "parse_copy_verification_response",
        code: "invalid_response",
        ...safeErrorLogFields(file.error.cause),
      });
      return Result.err({ code: "invalid_response", cause: file.error.cause });
    }
    if (!isDriveFile(file.value)) {
      LOGGER.warn("identity.google.visible_recovery_copies.failed", {
        operation: "parse_copy_verification_response",
        code: "invalid_response",
      });
      return Result.err({ code: "invalid_response" });
    }

    const reference = parseDriveFileRevision(file.value);
    if (
      reference === null ||
      file.value.name !== fileName ||
      file.value.trashed !== false ||
      !Array.isArray(file.value.parents) ||
      file.value.parents.length !== 1 ||
      file.value.parents[0] !== folderId ||
      !sameDriveFileIdentity(reference, expectedReference)
    ) {
      LOGGER.warn("identity.google.visible_recovery_copies.failed", {
        operation: "parse_copy_verification_response",
        code: "invalid_response",
      });
      return Result.err({ code: "invalid_response" });
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
    let pagesRead = 0;

    do {
      if (pagesRead >= MAXIMUM_LIST_PAGES) {
        LOGGER.warn("identity.google.visible_recovery_copies.failed", {
          operation,
          code: "invalid_response",
        });
        return Result.err({ code: "invalid_response" });
      }
      pagesRead += 1;

      const response = await this.fetchVisible(operation, url(pageToken), {
        headers: authorizationHeaders(token),
      });
      if (Result.isError(response)) return Result.err(response.error);
      if (!response.value.ok) {
        return this.httpResponseFailure(
          response.value,
          operation,
          mapDeletionStatus(response.value.status),
        );
      }

      const list = await this.parseListResponse(response.value, operation);
      if (Result.isError(list)) return Result.err(list.error);
      if (!list.value.files.every(validate)) {
        LOGGER.warn("identity.google.visible_recovery_copies.failed", {
          operation,
          code: "invalid_response",
        });
        return Result.err({ code: "invalid_response" });
      }
      files.push(...list.value.files);

      pageToken = list.value.nextPageToken;
      if (pageToken && seenPageTokens.has(pageToken)) {
        LOGGER.warn("identity.google.visible_recovery_copies.failed", {
          operation,
          code: "invalid_response",
        });
        return Result.err({ code: "invalid_response" });
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
    return this.httpResponseFailure(
      response.value,
      "delete_file",
      mapDeletionStatus(response.value.status),
    );
  }

  private async parseListResponse(
    response: Response,
    operation: VisibleCopiesOperation,
  ): Promise<VisibleCopiesResult<DriveFileList>> {
    const parsed = await readDriveJson(response);
    if (Result.isError(parsed)) {
      LOGGER.warn("identity.google.visible_recovery_copies.failed", {
        operation,
        code: "invalid_response",
        ...safeErrorLogFields(parsed.error.cause),
      });
      return Result.err({ code: "invalid_response", cause: parsed.error.cause });
    }
    const list = parseDriveFileList(parsed.value);
    if (list !== null) return Result.ok(list);
    LOGGER.warn("identity.google.visible_recovery_copies.failed", {
      operation,
      code: "invalid_response",
    });
    return Result.err({ code: "invalid_response" });
  }

  private async fetchVisible(
    operation: VisibleCopiesOperation,
    input: string,
    init: RequestInit,
  ): Promise<VisibleCopiesResult<Response>> {
    const response = await fetchDrive(this.fetchImpl, input, init);
    if (!Result.isError(response)) return Result.ok(response.value);
    LOGGER.warn("identity.google.visible_recovery_copies.failed", {
      operation,
      code: "network_failed",
      ...safeErrorLogFields(response.error.cause),
    });
    return Result.err(response.error);
  }

  private async httpResponseFailure<Success>(
    response: Response,
    operation: VisibleCopiesOperation,
    code: VisibleCopiesErrorCode,
  ): Promise<VisibleCopiesResult<Success>> {
    const failure = await createDriveHttpResponseFailure(response, code);
    LOGGER.warn("identity.google.visible_recovery_copies.failed", {
      operation,
      code,
      httpStatus: failure.httpStatus,
      ...safeErrorLogFields(failure.cause),
    });
    return Result.err(failure);
  }
}

function folderLookupUrl(pageToken?: string): string {
  const params = new URLSearchParams({
    spaces: "drive",
    q: folderQuery(),
    fields: "nextPageToken,files(id,name,mimeType)",
    pageSize: LIST_PAGE_SIZE,
  });
  if (pageToken) params.set("pageToken", pageToken);
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
  return listUrl(
    {
      q: folderQuery(),
      fields: "nextPageToken,files(id,name,mimeType,parents,trashed)",
    },
    pageToken,
  );
}

function fileListUrl(folderId: string, fileName: string, pageToken?: string): string {
  return listUrl(
    {
      q: `name = '${fileName}' and '${folderId}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,parents,trashed)",
    },
    pageToken,
  );
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

function visibleRecoveryFileName(publicIdentity: PubkyPublicIdentity): string | null {
  return isPubkyPublicIdentity(publicIdentity) ? `${publicIdentity.publicKeyZ32}.json` : null;
}

function browserRequestLock(): RequestLock | null {
  if (typeof navigator === "undefined" || navigator.locks === undefined) return null;
  return <LockResult>(name: string, callback: () => Promise<LockResult>) =>
    navigator.locks.request(name, callback);
}

function invalidFolderList(): VisibleCopiesResult<never> {
  LOGGER.warn("identity.google.visible_recovery_copies.failed", {
    operation: "parse_folder_list_response",
    code: "invalid_response",
  });
  return Result.err({ code: "invalid_response" });
}

function isExpectedFolder(file: DriveFile): file is VisibleFolder {
  return (
    typeof file.id === "string" &&
    DRIVE_FILE_ID_PATTERN.test(file.id) &&
    file.name === VISIBLE_RECOVERY_FOLDER_NAME &&
    file.mimeType === DRIVE_FOLDER_MIME_TYPE &&
    Array.isArray(file.parents) &&
    file.parents.length === 1 &&
    typeof file.parents[0] === "string" &&
    DRIVE_FILE_ID_PATTERN.test(file.parents[0]) &&
    file.trashed === false
  );
}

function isExpectedFile(file: DriveFile, folderId: string, fileName: string): file is VisibleFile {
  return (
    typeof file.id === "string" &&
    DRIVE_FILE_ID_PATTERN.test(file.id) &&
    file.name === fileName &&
    Array.isArray(file.parents) &&
    file.parents.length === 1 &&
    file.parents[0] === folderId &&
    file.trashed === false
  );
}

function mapDeletionStatus(status: number): VisibleCopiesErrorCode {
  return status === 401
    ? "unauthorized"
    : status === 403
      ? "forbidden"
      : status >= 500
        ? "network_failed"
        : "delete_failed";
}

type VisibleCopiesOperation =
  | "access_token"
  | "serialize_envelope"
  | "visible_file_name"
  | "validate_file_name"
  | "list_folder"
  | "create_folder"
  | "create_folder_lock"
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
