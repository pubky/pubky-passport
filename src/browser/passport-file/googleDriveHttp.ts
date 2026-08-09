import "client-only";

import { readBoundedText } from "../../libs/http/boundedBody";

const MAXIMUM_GOOGLE_DRIVE_JSON_RESPONSE_BYTES = 16 * 1024;
const MULTIPART_BOUNDARY = "pubky-passport-drive-boundary-v1";

export const GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
export const GOOGLE_DRIVE_UPLOAD_FILES_URL = "https://www.googleapis.com/upload/drive/v3/files";
export const GOOGLE_DRIVE_MULTIPART_CONTENT_TYPE = `multipart/related; boundary=${MULTIPART_BOUNDARY}`;

export type GoogleDriveFile = Record<string, unknown>;

export type GoogleDriveFileList = {
  files: GoogleDriveFile[];
  nextPageToken?: string;
};

type GoogleDriveFetchOutcome =
  | { status: "received"; response: Response }
  | { status: "network_failed" };

type GoogleDriveJsonOutcome =
  | { status: "parsed"; value: unknown }
  | { status: "invalid_response" };

export async function fetchGoogleDrive(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<GoogleDriveFetchOutcome> {
  try {
    return { status: "received", response: await fetchImpl(input, init) };
  } catch {
    return { status: "network_failed" };
  }
}

export async function readGoogleDriveJson(response: Response): Promise<GoogleDriveJsonOutcome> {
  const contents = await readBoundedText(response, MAXIMUM_GOOGLE_DRIVE_JSON_RESPONSE_BYTES);
  if (contents === null || contents === "too_large") return { status: "invalid_response" };
  try {
    return { status: "parsed", value: JSON.parse(contents) };
  } catch {
    return { status: "invalid_response" };
  }
}

export function parseGoogleDriveFileList(value: unknown): GoogleDriveFileList | null {
  if (!isGoogleDriveFile(value)) return null;
  if (!Array.isArray(value.files) || !value.files.every(isGoogleDriveFile)) return null;
  if (value.nextPageToken !== undefined && typeof value.nextPageToken !== "string") return null;
  return {
    files: value.files,
    ...(typeof value.nextPageToken === "string" ? { nextPageToken: value.nextPageToken } : {}),
  };
}

export function isGoogleDriveFile(value: unknown): value is GoogleDriveFile {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function googleDriveAuthorizationHeaders(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export function mapGoogleDriveStatus<T extends string>(
  status: number,
  fallback: T,
): T | "unauthorized" | "forbidden" {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  return fallback;
}

export function createGoogleDriveMultipartBody(
  contents: string,
  metadata: Record<string, unknown>,
): string {
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
