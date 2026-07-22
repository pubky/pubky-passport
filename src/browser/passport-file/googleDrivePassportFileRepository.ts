import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { PassportFileEnvelopeV1 } from "../../features/passport-file/passportFile";
import {
  parsePassportFileContents,
  parsePassportFileEnvelope,
  type PassportFileUrlOptions,
} from "../../features/passport-file/parsePassportFile";
import { readBoundedText } from "../../libs/security/boundedBody";
import type {
  PassportFileReadResult,
  PassportFileStore,
  PassportFileStoreErrorCode,
  PassportFileStoreResult,
} from "./passportFilePorts";

export type GoogleDriveAccessTokenProvider = () => Promise<string | null | undefined>;

export type GoogleDrivePassportFileRepositoryOptions = PassportFileUrlOptions & {
  accessTokenProvider: GoogleDriveAccessTokenProvider;
  fetch: typeof fetch;
};

type DriveFile = {
  id?: unknown;
  name?: unknown;
};

type DriveListResponse = {
  files?: unknown;
  nextPageToken?: unknown;
};

type LocatedFileState = { status: "missing" } | { status: "found"; fileId: string };
type LocatedFileResult = ResultType<LocatedFileState, { code: PassportFileStoreErrorCode }>;

const driveFilesUrl = "https://www.googleapis.com/drive/v3/files";
const driveUploadFilesUrl = "https://www.googleapis.com/upload/drive/v3/files";
const passportFileName = "passport.json";
const multipartBoundary = "pubky-passport-drive-boundary-v1";
const maximumPassportFileBytes = 16 * 1024;
const maximumDriveListResponseBytes = 16 * 1024;

export class GoogleDrivePassportFileRepository implements PassportFileStore {
  private readonly accessTokenProvider: GoogleDriveAccessTokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly urlOptions: PassportFileUrlOptions;

  constructor(options: GoogleDrivePassportFileRepositoryOptions) {
    this.accessTokenProvider = options.accessTokenProvider;
    this.fetchImpl = options.fetch;
    this.urlOptions = options.allowLocalhostHttp === undefined ? {} : { allowLocalhostHttp: options.allowLocalhostHttp };
  }

  async readPassportFile(): Promise<PassportFileStoreResult<PassportFileReadResult>> {
    const token = await this.getAccessToken();
    if (Result.isError(token)) {
      return failure(token.error.code);
    }

    const locatedFile = await this.locatePassportFile(token.value);
    if (Result.isError(locatedFile)) {
      return failure(locatedFile.error.code);
    }

    if (locatedFile.value.status === "missing") {
      return success({ status: "missing" });
    }

    const response = await this.fetchDrive(mediaReadUrl(locatedFile.value.fileId), {
      headers: authorizationHeaders(token.value),
    });
    if (response.status === 404) {
      return success({ status: "missing" });
    }

    if (!response.ok) {
      return failure(mapDriveStatus(response.status, "invalid_response"));
    }

    const contents = await readBoundedText(response, maximumPassportFileBytes);
    if (contents === "too_large") {
      return failure("invalid_file");
    }
    if (contents === null) {
      return failure("invalid_response");
    }

    const parsed = parsePassportFileContents(contents, this.urlOptions);
    if (Result.isError(parsed)) {
      return failure("invalid_file");
    }

    return success({ status: "found", envelope: parsed.value });
  }

  async writePassportFile(input: { envelope: PassportFileEnvelopeV1 }): Promise<PassportFileStoreResult<void>> {
    const serializedEnvelope = serializeEnvelope(input.envelope, this.urlOptions);
    if (Result.isError(serializedEnvelope)) {
      return failure(serializedEnvelope.error.code);
    }

    const token = await this.getAccessToken();
    if (Result.isError(token)) {
      return failure(token.error.code);
    }

    const locatedFile = await this.locatePassportFile(token.value);
    if (Result.isError(locatedFile)) {
      return failure(locatedFile.error.code);
    }

    const response = locatedFile.value.status === "missing"
      ? await this.createPassportFile(token.value, serializedEnvelope.value)
      : await this.updatePassportFile(token.value, locatedFile.value.fileId, serializedEnvelope.value);

    if (!response.ok) {
      return failure(mapDriveStatus(response.status, "write_failed"));
    }

    return success(undefined);
  }

  private async getAccessToken(): Promise<PassportFileStoreResult<string>> {
    let token: string | null | undefined;
    try {
      token = await this.accessTokenProvider();
    } catch {
      return failure("unauthorized");
    }

    if (typeof token !== "string" || token.length === 0) {
      return failure("unauthorized");
    }

    return success(token);
  }

  private async locatePassportFile(token: string): Promise<LocatedFileResult> {
    const response = await this.fetchDrive(listUrl(), { headers: authorizationHeaders(token) });
    if (!response.ok) {
      return failure(mapDriveStatus(response.status, "invalid_response"));
    }

    const listContents = await readBoundedText(response, maximumDriveListResponseBytes);
    if (listContents === null || listContents === "too_large") {
      return failure("invalid_response");
    }

    const list = parseJsonContents(listContents);
    if (!isDriveListResponse(list)) {
      return failure("invalid_response");
    }

    const files = list.files.filter((file): file is { id: string; name: string } => {
      return typeof file.id === "string" && typeof file.name === "string" && file.name === passportFileName;
    });

    if (files.length !== list.files.length) {
      return failure("invalid_response");
    }

    if (files.length === 0 && !list.nextPageToken) {
      return Result.ok({ status: "missing" });
    }

    if (files.length !== 1 || list.nextPageToken) {
      return failure("duplicate_files");
    }

    const file = files[0];
    if (!file) {
      return failure("invalid_response");
    }

    return Result.ok({ status: "found", fileId: file.id });
  }

  private async createPassportFile(token: string, envelopeJson: string): Promise<Response> {
    return this.fetchDrive(`${driveUploadFilesUrl}?uploadType=multipart`, {
      method: "POST",
      headers: {
        ...authorizationHeaders(token),
        "Content-Type": `multipart/related; boundary=${multipartBoundary}`,
      },
      body: createMultipartBody(envelopeJson),
    });
  }

  private async updatePassportFile(token: string, fileId: string, envelopeJson: string): Promise<Response> {
    return this.fetchDrive(mediaUpdateUrl(fileId), {
      method: "PATCH",
      headers: {
        ...authorizationHeaders(token),
        "Content-Type": "application/json",
      },
      body: envelopeJson,
    });
  }

  private async fetchDrive(input: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(input, init);
    } catch {
      return new Response(null, { status: 599 });
    }
  }
}

function listUrl(): string {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name = '${passportFileName}' and trashed = false`,
    fields: "nextPageToken,files(id,name)",
    pageSize: "2",
  });
  return `${driveFilesUrl}?${params.toString()}`;
}

function mediaReadUrl(fileId: string): string {
  return `${driveFilesUrl}/${encodeURIComponent(fileId)}?alt=media`;
}

function mediaUpdateUrl(fileId: string): string {
  return `${driveUploadFilesUrl}/${encodeURIComponent(fileId)}?uploadType=media`;
}

function authorizationHeaders(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function createMultipartBody(envelopeJson: string): string {
  const metadata = JSON.stringify({ name: passportFileName, parents: ["appDataFolder"] });
  return [
    `--${multipartBoundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    metadata,
    `--${multipartBoundary}`,
    "Content-Type: application/json",
    "",
    envelopeJson,
    `--${multipartBoundary}--`,
    "",
  ].join("\r\n");
}

function serializeEnvelope(
  envelope: PassportFileEnvelopeV1,
  options: PassportFileUrlOptions,
): PassportFileStoreResult<string> {
  const parsed = parsePassportFileEnvelope(envelope, options);
  if (Result.isError(parsed)) {
    return failure("invalid_file");
  }

  return success(JSON.stringify({
    v: parsed.value.v,
    iv: parsed.value.iv,
    ct: parsed.value.ct,
    url: parsed.value.url,
  }));
}

function parseJsonContents(contents: string): unknown {
  try {
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

function isDriveListResponse(value: unknown): value is { files: Array<{ id?: unknown; name?: unknown }>; nextPageToken?: string } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const response = value as DriveListResponse;
  if (!Array.isArray(response.files)) {
    return false;
  }

  if (response.nextPageToken !== undefined && typeof response.nextPageToken !== "string") {
    return false;
  }

  return response.files.every(isDriveFile);
}

function isDriveFile(value: unknown): value is DriveFile {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function mapDriveStatus(status: number, fallback: PassportFileStoreErrorCode): PassportFileStoreErrorCode {
  if (status === 599) {
    return "network_failed";
  }
  if (status === 401) {
    return "unauthorized";
  }
  if (status === 403) {
    return "forbidden";
  }
  if (status === 404) {
    return fallback;
  }
  return fallback;
}

function success<T>(value: T): PassportFileStoreResult<T> {
  return Result.ok(value);
}

function failure<T>(code: PassportFileStoreErrorCode): PassportFileStoreResult<T> {
  return Result.err({ code });
}
