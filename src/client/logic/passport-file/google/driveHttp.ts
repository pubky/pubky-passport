import "client-only";

import { Result, type Result as ResultType } from "better-result";
import { z } from "zod";

import { readBoundedText } from "../../../../libs/http/boundedBody";
import type { CodedFailure } from "../../../../libs/result";

const MAXIMUM_JSON_RESPONSE_BYTES = 16 * 1024;
const MULTIPART_BOUNDARY = "pubky-passport-drive-boundary-v1";

export const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
export const DRIVE_UPLOAD_FILES_URL = "https://www.googleapis.com/upload/drive/v3/files";
export const DRIVE_MULTIPART_CONTENT_TYPE = `multipart/related; boundary=${MULTIPART_BOUNDARY}`;

const DRIVE_FILE_SCHEMA = z.object({
  id: z.unknown().optional(),
  mimeType: z.unknown().optional(),
  name: z.unknown().optional(),
  parents: z.unknown().optional(),
  trashed: z.unknown().optional(),
  version: z.unknown().optional(),
}).strict();
const DRIVE_FILE_LIST_SCHEMA = z.object({
  files: z.array(DRIVE_FILE_SCHEMA),
  nextPageToken: z.string().optional(),
}).strict();

export type DriveFile = z.infer<typeof DRIVE_FILE_SCHEMA>;
export type DriveFileList = z.infer<typeof DRIVE_FILE_LIST_SCHEMA>;
export type DriveFileRevision = Readonly<{ storageId: string; revision: string }>;
type DriveFetchResult = ResultType<Response, CodedFailure<"network_failed">>;

/**
 * Executes an isolated, non-cacheable Drive request without leaking transport
 * exceptions. Diagnostic causes remain internal to the typed failure.
 */
export async function fetchDrive(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<DriveFetchResult> {
  try {
    return Result.ok(await fetchImpl(input, {
      ...init,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    }));
  } catch (cause) {
    return Result.err({ code: "network_failed", cause });
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
  const parsed = DRIVE_FILE_LIST_SCHEMA.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isDriveFile(value: unknown): value is DriveFile {
  return DRIVE_FILE_SCHEMA.safeParse(value).success;
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

/**
 * Compares stable Drive file identity without treating server-managed metadata
 * changes as replacement of the file itself.
 */
export function sameDriveFileIdentity(left: DriveFileRevision, right: DriveFileRevision): boolean {
  return left.storageId === right.storageId;
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
