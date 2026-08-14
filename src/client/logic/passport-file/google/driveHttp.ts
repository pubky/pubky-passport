import "client-only";

import { readBoundedText } from "../../../../libs/http/boundedBody";

const MAXIMUM_JSON_RESPONSE_BYTES = 16 * 1024;
const MULTIPART_BOUNDARY = "pubky-passport-drive-boundary-v1";

/** Google Drive v3 metadata endpoint. */
export const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
/** Google Drive v3 media-upload endpoint. */
export const DRIVE_UPLOAD_FILES_URL = "https://www.googleapis.com/upload/drive/v3/files";
/** Content type for the fixed-boundary multipart bodies produced by this module. */
export const DRIVE_MULTIPART_CONTENT_TYPE = `multipart/related; boundary=${MULTIPART_BOUNDARY}`;

/** Untrusted JSON object returned by Google Drive. */
export type DriveFile = Record<string, unknown>;
/** Structurally validated Drive file-list response. */
export type DriveFileList = { files: DriveFile[]; nextPageToken?: string };

/**
 * Executes a Drive request without allowing transport exceptions to escape.
 * Returns `null` for network, abort, and other fetch failures.
 */
export async function fetchDrive(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<Response | null> {
  try {
    return await fetchImpl(input, init);
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

/** Validates the outer structure of a Drive file-list response. */
export function parseDriveFileList(value: unknown): DriveFileList | null {
  if (!isDriveFile(value)) return null;
  if (!Array.isArray(value.files) || !value.files.every(isDriveFile)) return null;
  if (value.nextPageToken !== undefined && typeof value.nextPageToken !== "string") return null;
  return {
    files: value.files,
    ...(typeof value.nextPageToken === "string" ? { nextPageToken: value.nextPageToken } : {}),
  };
}

/** Returns whether a value is a plain object suitable for field validation. */
export function isDriveFile(value: unknown): value is DriveFile {
  return Boolean(value)
    && typeof value === "object"
    && Object.getPrototypeOf(value) === Object.prototype;
}

/** Narrows an unknown Drive field to a non-empty string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Creates a bearer authorization header for a Drive request. */
export function authorizationHeaders(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/** Maps Drive authorization statuses while preserving the operation fallback. */
export function mapDriveStatus<Fallback extends string>(
  status: number,
  fallback: Fallback,
): Fallback | "unauthorized" | "forbidden" {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  return fallback;
}

/** Builds a Drive multipart body containing JSON metadata and JSON file contents. */
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

/** Builds an exact Drive file endpoint with the opaque file ID URL-encoded. */
export function driveFileUrl(fileId: string): string {
  return `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`;
}
