import "client-only";

import { readBoundedText } from "../../../../libs/http/boundedBody";

const MAXIMUM_JSON_RESPONSE_BYTES = 16 * 1024;
const MULTIPART_BOUNDARY = "pubky-passport-drive-boundary-v1";

export const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
export const DRIVE_UPLOAD_FILES_URL = "https://www.googleapis.com/upload/drive/v3/files";
export const DRIVE_MULTIPART_CONTENT_TYPE = `multipart/related; boundary=${MULTIPART_BOUNDARY}`;

export type DriveFile = Record<string, unknown>;
export type DriveFileList = { files: DriveFile[]; nextPageToken?: string };
export type DriveFileRevision = Readonly<{ storageId: string; revision: string }>;

/**
 * Executes an isolated, non-cacheable Drive request without leaking transport
 * exceptions. Returns `null` for network, abort, and other fetch failures.
 */
export async function fetchDrive(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<Response | null> {
  try {
    return await fetchImpl(input, {
      ...init,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  } catch {
    return null;
  }
}

/**
 * Reads and parses a size-bounded Drive JSON response.
 * Returns `null` for oversized, unreadable, or malformed response bodies.
 */
export async function readDriveJson(response: Response): Promise<unknown | null> {
  const contents = await readBoundedText(response, MAXIMUM_JSON_RESPONSE_BYTES);
  if (contents === null || contents === "too_large") return null;
  try {
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

export function parseDriveFileList(value: unknown): DriveFileList | null {
  if (!isDriveFile(value)) return null;
  if (!Array.isArray(value.files) || !value.files.every(isDriveFile)) return null;
  if (value.nextPageToken !== undefined && typeof value.nextPageToken !== "string") return null;
  return {
    files: value.files,
    ...(typeof value.nextPageToken === "string" ? { nextPageToken: value.nextPageToken } : {}),
  };
}

export function isDriveFile(value: unknown): value is DriveFile {
  return Boolean(value)
    && typeof value === "object"
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function parseDriveFileRevision(file: DriveFile): DriveFileRevision | null {
  return isNonEmptyString(file.id) && isNonEmptyString(file.version)
    ? { storageId: file.id, revision: file.version }
    : null;
}

export function sameDriveFileRevision(left: DriveFileRevision, right: DriveFileRevision): boolean {
  return left.storageId === right.storageId && left.revision === right.revision;
}

export function authorizationHeaders(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export function mapDriveStatus<Fallback extends string>(
  status: number,
  fallback: Fallback,
): Fallback | "unauthorized" | "forbidden" {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  return fallback;
}

export function multipartBody(contents: string, metadata: Record<string, unknown>): string {
  return [
    `--${MULTIPART_BOUNDARY}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${MULTIPART_BOUNDARY}`,
    "Content-Type: application/json",
    "",
    contents,
    `--${MULTIPART_BOUNDARY}--`,
    "",
  ].join("\r\n");
}

export function driveFileUrl(fileId: string): string {
  return `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`;
}
