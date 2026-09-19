import "client-only";

import { Result, type Result as ResultType } from "better-result";
import { z } from "zod";

import { readBoundedText } from "@/libs/http/boundedBody";
import { HttpResponseError } from "@/libs/http/HttpResponseError";
import { MAXIMUM_JSON_BODY_BYTES } from "@/libs/passportPolicy";
import { isNonEmptyString } from "@/libs/typeGuards";

const MULTIPART_BOUNDARY = "pubky-passport-drive-boundary-v1";

export const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
export const DRIVE_UPLOAD_FILES_URL = "https://www.googleapis.com/upload/drive/v3/files";
export const DRIVE_MULTIPART_CONTENT_TYPE = `multipart/related; boundary=${MULTIPART_BOUNDARY}`;

const DRIVE_FILE_SCHEMA = z
  .object({
    id: z.unknown().optional(),
    mimeType: z.unknown().optional(),
    name: z.unknown().optional(),
    parents: z.unknown().optional(),
    trashed: z.unknown().optional(),
    version: z.unknown().optional(),
  })
  .strict();
const DRIVE_FILE_LIST_SCHEMA = z
  .object({
    files: z.array(DRIVE_FILE_SCHEMA),
    nextPageToken: z.string().optional(),
  })
  .strict();

export type DriveFile = z.infer<typeof DRIVE_FILE_SCHEMA>;
export type DriveFileList = z.infer<typeof DRIVE_FILE_LIST_SCHEMA>;
export type DriveFileRevision = Readonly<{ storageId: string; revision: string }>;
type DriveFetchResult = ResultType<Response, { code: "network_failed"; cause: unknown }>;
export type DriveHttpResponseFailure<Code extends string> = {
  code: Code;
  httpStatus: number;
  cause: HttpResponseError;
};
export type DriveJsonResult = ResultType<
  unknown,
  { code: "body_too_large" | "body_unavailable" | "invalid_json"; cause: Error }
>;

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
    return Result.ok(
      await fetchImpl(input, {
        ...init,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      }),
    );
  } catch (e) {
    return Result.err({ code: "network_failed", cause: e });
  }
}

/**
 * Reads and parses a size-bounded Drive JSON response.
 * The promise settles with a Result and preserves body-read and JSON parse causes.
 */
export async function readDriveJson(response: Response): Promise<DriveJsonResult> {
  const contents = await readBoundedText(response, MAXIMUM_JSON_BODY_BYTES);
  if (Result.isError(contents)) return Result.err(contents.error);
  try {
    return Result.ok(JSON.parse(contents.value));
  } catch (e) {
    return Result.err({
      code: "invalid_json",
      cause: new Error("Google Drive response must be valid JSON.", { cause: e }),
    });
  }
}

/**
 * Retains bounded diagnostics for an unsuccessful Drive response.
 *
 * The response body remains non-enumerable inside {@link HttpResponseError} and
 * must not be copied into logs or caller-visible messages.
 */
export async function createDriveHttpResponseFailure<Code extends string>(
  response: Response,
  code: Code,
): Promise<DriveHttpResponseFailure<Code>> {
  const contents = await readBoundedText(response, MAXIMUM_JSON_BODY_BYTES);
  const responseBody = Result.isOk(contents)
    ? contents.value
    : contents.error.code === "body_too_large"
      ? "too_large"
      : null;
  const cause = new HttpResponseError(
    response.status,
    response.statusText,
    responseBody,
    Result.isError(contents) && contents.error.code === "body_unavailable"
      ? { cause: contents.error.cause }
      : undefined,
  );

  return { code, httpStatus: response.status, cause };
}

export function parseDriveFileList(value: unknown): DriveFileList | null {
  const parsed = DRIVE_FILE_LIST_SCHEMA.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isDriveFile(value: unknown): value is DriveFile {
  return DRIVE_FILE_SCHEMA.safeParse(value).success;
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

export type RequestLock = <LockResult>(
  name: string,
  callback: () => Promise<LockResult>,
) => Promise<LockResult>;

/**
 * Web Locks-backed request lock, or `null` when `navigator.locks` is unavailable (server
 * rendering, unsupported browsers); callers then run the critical section unguarded.
 */
export function browserRequestLock(): RequestLock | null {
  if (typeof navigator === "undefined" || navigator.locks === undefined) return null;
  return <LockResult>(name: string, callback: () => Promise<LockResult>) =>
    navigator.locks.request(name, callback);
}
