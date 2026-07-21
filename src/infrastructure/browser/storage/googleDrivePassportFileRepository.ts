import "client-only";

import type { PassportFileEnvelopeV1 } from "../../../core/domain/passport-file/passportFile";
import {
  parsePassportFileContents,
  parsePassportFileEnvelope,
  type PassportFileUrlOptions,
} from "../../../core/pipes/passport-file/parsePassportFile";
import type {
  PassportFileReadResult,
  PassportFileRepository,
  PassportFileRepositoryErrorCode,
  PassportFileRepositoryResult,
} from "../../../core/ports/passportFileRepository";

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

type LocatedFileResult =
  | { ok: true; status: "missing" }
  | { ok: true; status: "found"; fileId: string }
  | { ok: false; code: PassportFileRepositoryErrorCode };

const driveFilesUrl = "https://www.googleapis.com/drive/v3/files";
const driveUploadFilesUrl = "https://www.googleapis.com/upload/drive/v3/files";
const passportFileName = "passport.json";
const multipartBoundary = "pubky-passport-drive-boundary-v1";
const maximumPassportFileBytes = 16 * 1024;
const maximumDriveListResponseBytes = 16 * 1024;

export class GoogleDrivePassportFileRepository implements PassportFileRepository {
  private readonly accessTokenProvider: GoogleDriveAccessTokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly urlOptions: PassportFileUrlOptions;

  constructor(options: GoogleDrivePassportFileRepositoryOptions) {
    this.accessTokenProvider = options.accessTokenProvider;
    this.fetchImpl = options.fetch;
    this.urlOptions = options.allowLocalhostHttp === undefined ? {} : { allowLocalhostHttp: options.allowLocalhostHttp };
  }

  async readPassportFile(): Promise<PassportFileRepositoryResult<PassportFileReadResult>> {
    const token = await this.getAccessToken();
    if (!token.ok) {
      return failure(token.code);
    }

    const locatedFile = await this.locatePassportFile(token.value);
    if (!locatedFile.ok) {
      return failure(locatedFile.code);
    }

    if (locatedFile.status === "missing") {
      return success({ status: "missing" });
    }

    const response = await this.fetchDrive(mediaReadUrl(locatedFile.fileId), {
      headers: authorizationHeaders(token.value),
    });
    if (response.status === 404) {
      return success({ status: "missing" });
    }

    if (!response.ok) {
      return failure(mapDriveStatus(response.status, "invalid_response"));
    }

    const contents = await safeReadText(response, maximumPassportFileBytes);
    if (contents === "too_large") {
      return failure("invalid_file");
    }
    if (contents === null) {
      return failure("invalid_response");
    }

    const parsed = parsePassportFileContents(contents, this.urlOptions);
    if (!parsed.ok) {
      return failure("invalid_file");
    }

    return success({ status: "found", envelope: parsed.envelope });
  }

  async writePassportFile(input: { envelope: PassportFileEnvelopeV1 }): Promise<PassportFileRepositoryResult<void>> {
    const serializedEnvelope = serializeEnvelope(input.envelope, this.urlOptions);
    if (!serializedEnvelope.ok) {
      return failure("invalid_file");
    }

    const token = await this.getAccessToken();
    if (!token.ok) {
      return failure(token.code);
    }

    const locatedFile = await this.locatePassportFile(token.value);
    if (!locatedFile.ok) {
      return failure(locatedFile.code);
    }

    const response = locatedFile.status === "missing"
      ? await this.createPassportFile(token.value, serializedEnvelope.value)
      : await this.updatePassportFile(token.value, locatedFile.fileId, serializedEnvelope.value);

    if (!response.ok) {
      return failure(mapDriveStatus(response.status, "write_failed"));
    }

    return success(undefined);
  }

  private async getAccessToken(): Promise<{ ok: true; value: string } | { ok: false; code: PassportFileRepositoryErrorCode }> {
    let token: string | null | undefined;
    try {
      token = await this.accessTokenProvider();
    } catch {
      return { ok: false, code: "unauthorized" };
    }

    if (typeof token !== "string" || token.length === 0) {
      return { ok: false, code: "unauthorized" };
    }

    return { ok: true, value: token };
  }

  private async locatePassportFile(token: string): Promise<LocatedFileResult> {
    const response = await this.fetchDrive(listUrl(), { headers: authorizationHeaders(token) });
    if (!response.ok) {
      return { ok: false, code: mapDriveStatus(response.status, "invalid_response") };
    }

    const listContents = await safeReadText(response, maximumDriveListResponseBytes);
    if (listContents === null || listContents === "too_large") {
      return { ok: false, code: "invalid_response" };
    }

    const list = parseJsonContents(listContents);
    if (!isDriveListResponse(list)) {
      return { ok: false, code: "invalid_response" };
    }

    const files = list.files.filter((file): file is { id: string; name: string } => {
      return typeof file.id === "string" && file.name === passportFileName;
    });

    if (files.length !== list.files.length) {
      return { ok: false, code: "invalid_response" };
    }

    if (files.length === 0 && !list.nextPageToken) {
      return { ok: true, status: "missing" };
    }

    if (files.length !== 1 || list.nextPageToken) {
      return { ok: false, code: "duplicate_files" };
    }

    const file = files[0];
    if (!file) {
      return { ok: false, code: "invalid_response" };
    }

    return { ok: true, status: "found", fileId: file.id };
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
): { ok: true; value: string } | { ok: false } {
  const parsed = parsePassportFileEnvelope(envelope, options);
  if (!parsed.ok) {
    return { ok: false };
  }

  return {
    ok: true,
    value: JSON.stringify({
      v: parsed.envelope.v,
      iv: parsed.envelope.iv,
      ct: parsed.envelope.ct,
      url: parsed.envelope.url,
    }),
  };
}

function parseJsonContents(contents: string): unknown {
  try {
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

async function safeReadText(response: Response, maximumBytes: number): Promise<string | "too_large" | null> {
  if (contentLengthExceeds(response.headers.get("Content-Length"), maximumBytes)) {
    try {
      await response.body?.cancel();
    } catch {
      // The oversized response is already rejected; cancellation is best effort.
    }
    return "too_large";
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The oversized response is already rejected; cancellation is best effort.
        }
        return "too_large";
      }

      chunks.push(value);
    }

    const contents = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      contents.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder().decode(contents);
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function contentLengthExceeds(contentLength: string | null, maximumBytes: number): boolean {
  return contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > maximumBytes;
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

function mapDriveStatus(status: number, fallback: PassportFileRepositoryErrorCode): PassportFileRepositoryErrorCode {
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

function success<T>(value: T): PassportFileRepositoryResult<T> {
  return { ok: true, value };
}

function failure<T>(code: PassportFileRepositoryErrorCode): PassportFileRepositoryResult<T> {
  return { ok: false, error: { code } };
}
