import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../../../libs/logger/logger";
import type { PassportFileEnvelopeV1 } from "../passportFileEnvelope";
import { GoogleDriveVisibleRecoveryCopies } from "./GoogleDriveVisibleRecoveryCopies";

const ACCESS_TOKEN = "SECRET-DRIVE-TOKEN";
const PUBLIC_KEY_Z32 = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const PUBLIC_KEY_DISPLAY = `pubky${PUBLIC_KEY_Z32}`;
const PUBLIC_IDENTITY = { publicKeyZ32: PUBLIC_KEY_Z32,};
const VISIBLE_FILE_NAME = `${PUBLIC_KEY_DISPLAY}.json`;
const ENVELOPE: PassportFileEnvelopeV1 = {
  v: 1,
  iv: "AAECAwQFBgcICQoL",
  ct: "YZy1I_a6WzFnql8rW2A94EJrgz38Sqd1LV_KjVe2Qd2n1mvFMXg9qzRHwJ_WQvrm",
  url: "https://passport.pubky.app/",
};
const FOLDER = {
  id: "SECRET-FOLDER-ID",
  name: "Pubky Passport",
  mimeType: "application/vnd.google-apps.folder",
};
const SIGNAL = new AbortController().signal;

afterEach(() => vi.restoreAllMocks());

describe("GoogleDriveVisibleRecoveryCopies creation", () => {
  it("creates the visible folder and identity-named encrypted copy", async () => {
    const calls: SanitizedCall[] = [];
    const createdFolder = { ...FOLDER, trashed: false };
    const createdFile = { id: "SECRET-CREATED-ID", name: VISIBLE_FILE_NAME, version: "SECRET-REVISION" };
    const visibleCopies = createVisibleCopies([
      jsonResponse({ files: [] }),
      jsonResponse(createdFolder),
      jsonResponse({ files: [FOLDER] }),
      jsonResponse(createdFile),
      jsonResponse({ ...createdFile, trashed: false, parents: [FOLDER.id] }),
    ], calls);

    const result = await visibleCopies.createVisibleRecoveryCopy(
      ENVELOPE,
      PUBLIC_IDENTITY,
      new AbortController().signal,
    );

    expect(Result.isOk(result)).toBe(true);
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST", "GET", "POST", "GET"]);
    expect(calls[0]).toMatchObject({ endpoint: "drive_files", spaces: "drive", isFolderLookup: true });
    expect(calls[1]).toMatchObject({
      endpoint: "drive_files",
      createsExpectedFolder: true,
      createsInRoot: true,
    });
    expect(calls[3]).toMatchObject({
      endpoint: "drive_upload",
      uploadType: "multipart",
      visibleFileName: VISIBLE_FILE_NAME,
      hasExactEnvelope: true,
      hasExpectedFolderParent: true,
    });
    expect(calls[4]).toMatchObject({
      endpoint: "drive_file_metadata",
      metadataFields: "id,name,version,trashed,parents",
    });
    expect(calls.every((call) => call.method !== "PATCH" && call.method !== "DELETE")).toBe(true);
    expect(calls.every((call) => !call.readsMedia && call.hasSignal && call.hasExpectedBearerToken)).toBe(true);
    expect(JSON.stringify(calls)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(calls)).not.toContain(ENVELOPE.iv);
    expect(JSON.stringify(calls)).not.toContain(ENVELOPE.ct);
    expect(JSON.stringify(calls)).not.toContain(FOLDER.id);
  });

  it("allows concurrent repeated identity-named copies", async () => {
    const drive = new StatefulVisibleDrive();
    const createVisibleCopies = () => new GoogleDriveVisibleRecoveryCopies(ACCESS_TOKEN, drive.fetch);

    const [first, second] = await Promise.all([
      createVisibleCopies().createVisibleRecoveryCopy(ENVELOPE, PUBLIC_IDENTITY, SIGNAL),
      createVisibleCopies().createVisibleRecoveryCopy(ENVELOPE, PUBLIC_IDENTITY, SIGNAL),
    ]);

    expect(Result.isOk(first)).toBe(true);
    expect(Result.isOk(second)).toBe(true);
    expect(drive.uploadedNames).toEqual([VISIBLE_FILE_NAME, VISIBLE_FILE_NAME]);
  });

  it("rejects duplicate visible folders instead of selecting an ambiguous path", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const visibleCopies = createVisibleCopies([jsonResponse({ files: [FOLDER], nextPageToken: "more-folders" })]);

    const result = await visibleCopies.createVisibleRecoveryCopy(ENVELOPE, PUBLIC_IDENTITY, SIGNAL);

    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_response" });
    expect(warning).toHaveBeenCalledWith("identity.google.visible_recovery_copies.failed", {
      operation: "parse_folder_list_response",
      code: "invalid_response",
    });
    expect(warning).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing", FOLDER],
    ["string", { ...FOLDER, trashed: "false" }],
    ["true", { ...FOLDER, trashed: true }],
  ])("rejects a created folder with %s trashed metadata", async (_case, createdFolder) => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const visibleCopies = createVisibleCopies([jsonResponse({ files: [] }), jsonResponse(createdFolder)]);

    const result = await visibleCopies.createVisibleRecoveryCopy(ENVELOPE, PUBLIC_IDENTITY, SIGNAL);

    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_response" });
    expect(warning).toHaveBeenCalledWith("identity.google.visible_recovery_copies.failed", {
      operation: "parse_folder_response",
      code: "invalid_response",
    });
    expect(warning).toHaveBeenCalledOnce();
  });

  it.each([
    ["invalid alphabet", { publicKeyZ32: "0".repeat(52) }],
    ["short key", { publicKeyZ32: "y".repeat(51) }],
    ["long key", { publicKeyZ32: "y".repeat(53) }],
    ["noncanonical suffix", { publicKeyZ32: `${PUBLIC_KEY_Z32.slice(0, -1)}n` }],
  ])("rejects %s public identity filename input without accessing Drive", async (_case, publicIdentity) => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const calls: SanitizedCall[] = [];
    const visibleCopies = createVisibleCopies([], calls);

    const result = await visibleCopies.createVisibleRecoveryCopy(ENVELOPE, publicIdentity, SIGNAL);

    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_file" });
    expect(calls).toEqual([]);
    expect(warning).toHaveBeenCalledWith("identity.google.visible_recovery_copies.failed", {
      operation: "visible_file_name",
      code: "invalid_file",
    });
  });

  it("logs malformed valid JSON response shape once without response contents", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const visibleCopies = createVisibleCopies([jsonResponse({ files: "SECRET-MALFORMED-SHAPE" })]);

    const result = await visibleCopies.createVisibleRecoveryCopy(ENVELOPE, PUBLIC_IDENTITY, SIGNAL);

    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_response" });
    expect(warning).toHaveBeenCalledWith("identity.google.visible_recovery_copies.failed", {
      operation: "parse_folder_list_response",
      code: "invalid_response",
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-MALFORMED-SHAPE");
  });

  it("rejects an oversized Drive response before issuing a later request", async () => {
    const calls: SanitizedCall[] = [];
    const visibleCopies = createVisibleCopies([
      new Response("{}", { headers: { "Content-Length": String(16 * 1024 + 1) } }),
    ], calls);

    const result = await visibleCopies.createVisibleRecoveryCopy(ENVELOPE, PUBLIC_IDENTITY, SIGNAL);

    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_response" });
    expect(calls).toHaveLength(1);
  });

  it("owns a sanitized low-level permission failure log", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const visibleCopies = createVisibleCopies([jsonResponse({ error: "SECRET-UPSTREAM-BODY" }, 403)]);

    const result = await visibleCopies.createVisibleRecoveryCopy(ENVELOPE, PUBLIC_IDENTITY, SIGNAL);

    expect(Result.isError(result) && result.error).toEqual({ code: "forbidden" });
    expect(warning).toHaveBeenCalledWith("identity.google.visible_recovery_copies.failed", {
      operation: "list_folder",
      code: "forbidden",
    });
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain("SECRET-UPSTREAM-BODY");
    expect(logged).not.toContain(ACCESS_TOKEN);
    expect(logged).not.toContain(FOLDER.id);
  });

  it("stops before Drive access when the visible-copy signal is already aborted", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const calls: SanitizedCall[] = [];
    const controller = new AbortController();
    controller.abort();
    const visibleCopies = createVisibleCopies([], calls);

    const result = await visibleCopies.createVisibleRecoveryCopy(ENVELOPE, PUBLIC_IDENTITY, controller.signal);

    expect(Result.isError(result) && result.error).toEqual({ code: "network_failed" });
    expect(calls).toEqual([]);
    expect(warning).toHaveBeenCalledWith("identity.google.visible_recovery_copies.failed", {
      operation: "create_visible_copy",
      code: "network_failed",
    });
  });

  it("stops after an aborted folder lookup without issuing later Drive requests", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const calls: SanitizedCall[] = [];
    const controller = new AbortController();
    const cause = new DOMException("Aborted", "AbortError");
    const fetchMock = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push(sanitizedAbortCall(init));
      controller.abort();
      throw cause;
    }) as typeof fetch;
    const visibleCopies = new GoogleDriveVisibleRecoveryCopies(ACCESS_TOKEN, fetchMock);

    const result = await visibleCopies.createVisibleRecoveryCopy(ENVELOPE, PUBLIC_IDENTITY, controller.signal);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.code).toBe("network_failed");
      expect(result.error.cause).toBe(cause);
    }
    expect(calls).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith("identity.google.visible_recovery_copies.failed", {
      operation: "list_folder",
      code: "network_failed",
    });
  });

  it("does not verify metadata after the visible upload response is lost", async () => {
    const calls: SanitizedCall[] = [];
    const cause = new Error("SECRET-LOST-UPLOAD-RESPONSE");
    const visibleCopies = createVisibleCopies([
      jsonResponse({ files: [FOLDER] }),
      cause,
    ], calls);

    const result = await visibleCopies.createVisibleRecoveryCopy(ENVELOPE, PUBLIC_IDENTITY, SIGNAL);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.code).toBe("network_failed");
      expect(result.error.cause).toBe(cause);
    }
    expect(calls).toHaveLength(2);
    expect(calls[1]?.endpoint).toBe("drive_upload");
  });

  it("rejects created-file metadata that does not match the exact upload", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const created = { id: "SECRET-CREATED-ID", name: VISIBLE_FILE_NAME, version: "SECRET-REVISION" };
    const visibleCopies = createVisibleCopies([
      jsonResponse({ files: [FOLDER] }),
      jsonResponse(created),
      jsonResponse({ ...created, trashed: false, parents: ["WRONG-FOLDER"] }),
    ]);

    const result = await visibleCopies.createVisibleRecoveryCopy(ENVELOPE, PUBLIC_IDENTITY, SIGNAL);

    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_response" });
    expect(warning).toHaveBeenCalledWith("identity.google.visible_recovery_copies.failed", {
      operation: "parse_copy_verification_response",
      code: "invalid_response",
    });
    expect(warning).toHaveBeenCalledOnce();
  });

  it("accepts the created file when Drive advances its server-managed version", async () => {
    const created = { id: "SECRET-CREATED-ID", name: VISIBLE_FILE_NAME, version: "1" };
    const visibleCopies = createVisibleCopies([
      jsonResponse({ files: [FOLDER] }),
      jsonResponse(created),
      jsonResponse({ ...created, version: "2", trashed: false, parents: [FOLDER.id] }),
    ]);

    const result = await visibleCopies.createVisibleRecoveryCopy(ENVELOPE, PUBLIC_IDENTITY, SIGNAL);

    expect(Result.isOk(result)).toBe(true);
  });

  it("rejects created-file metadata for a different file ID", async () => {
    const created = { id: "SECRET-CREATED-ID", name: VISIBLE_FILE_NAME, version: "1" };
    const visibleCopies = createVisibleCopies([
      jsonResponse({ files: [FOLDER] }),
      jsonResponse(created),
      jsonResponse({
        ...created,
        id: "SECRET-DIFFERENT-ID",
        version: "2",
        trashed: false,
        parents: [FOLDER.id],
      }),
    ]);

    const result = await visibleCopies.createVisibleRecoveryCopy(ENVELOPE, PUBLIC_IDENTITY, SIGNAL);

    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_response" });
  });
});

type SanitizedCall = {
  endpoint: "drive_files" | "drive_upload" | "drive_file_metadata" | "unexpected";
  method: string;
  spaces: string | null;
  uploadType: string | null;
  metadataFields: string | null;
  isFolderLookup: boolean;
  createsExpectedFolder: boolean;
  createsInRoot: boolean;
  visibleFileName: string | null;
  hasExactEnvelope: boolean;
  hasExpectedFolderParent: boolean;
  hasExpectedBearerToken: boolean;
  readsMedia: boolean;
  hasSignal: boolean;
};

function createVisibleCopies(
  responses: Array<Response | Error>,
  calls: SanitizedCall[] = [],
) {
  const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = typeof init?.body === "string" ? init.body : "";
    const authorization = new Headers(init?.headers).get("Authorization");
    const endpoint = url.origin === "https://www.googleapis.com" && url.pathname === "/drive/v3/files"
      ? "drive_files"
      : url.origin === "https://www.googleapis.com" && url.pathname.startsWith("/drive/v3/files/")
        ? "drive_file_metadata"
        : url.origin === "https://www.googleapis.com" && url.pathname === "/upload/drive/v3/files"
          ? "drive_upload"
          : "unexpected";
    calls.push({
      endpoint,
      method: init?.method ?? "GET",
      spaces: url.searchParams.get("spaces"),
      uploadType: url.searchParams.get("uploadType"),
      metadataFields: url.searchParams.get("fields"),
      isFolderLookup: url.searchParams.get("q")?.includes("name = 'Pubky Passport'") === true,
      createsExpectedFolder: body.includes('"name":"Pubky Passport"')
        && body.includes('"mimeType":"application/vnd.google-apps.folder"'),
      createsInRoot: body.includes('"parents":["root"]'),
      visibleFileName: body.match(/"name":"(pubky[^"]+\.json)"/)?.[1] ?? null,
      hasExactEnvelope: body.includes(JSON.stringify({
        v: ENVELOPE.v,
        iv: ENVELOPE.iv,
        ct: ENVELOPE.ct,
        url: "https://passport.pubky.app",
      })),
      hasExpectedFolderParent: body.includes(`"parents":["${FOLDER.id}"]`),
      hasExpectedBearerToken: authorization === `Bearer ${ACCESS_TOKEN}`,
      readsMedia: url.searchParams.get("alt") === "media",
      hasSignal: init?.signal instanceof AbortSignal,
    });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected fetch call");
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
  return new GoogleDriveVisibleRecoveryCopies(ACCESS_TOKEN, fetchMock);
}

function sanitizedAbortCall(init?: RequestInit): SanitizedCall {
  return {
    endpoint: "drive_files",
    method: init?.method ?? "GET",
    spaces: null,
    uploadType: null,
    metadataFields: null,
    isFolderLookup: true,
    createsExpectedFolder: false,
    createsInRoot: false,
    visibleFileName: null,
    hasExactEnvelope: false,
    hasExpectedFolderParent: false,
    hasExpectedBearerToken: new Headers(init?.headers).get("Authorization") === `Bearer ${ACCESS_TOKEN}`,
    readsMedia: false,
    hasSignal: init?.signal instanceof AbortSignal,
  };
}

class StatefulVisibleDrive {
  uploadedNames: string[] = [];
  private files = new Map<string, { id: string; name: string; version: string; trashed: false; parents: string[] }>();

  fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const query = url.searchParams.get("q") ?? "";
    if (method === "POST") {
      const body = typeof init?.body === "string" ? init.body : "";
      const name = body.match(/"name":"(pubky[^"]+\.json)"/)?.[1];
      if (!name) throw new Error("Expected visible file upload");
      const file = {
        id: `file-${this.uploadedNames.length + 1}`,
        name,
        version: "1",
        trashed: false as const,
        parents: [FOLDER.id],
      };
      this.uploadedNames.push(name);
      this.files.set(file.id, file);
      return jsonResponse({ id: file.id, name: file.name, version: file.version });
    }
    if (query.includes("mimeType = 'application/vnd.google-apps.folder'")) {
      return jsonResponse({ files: [FOLDER] });
    }
    const fileId = url.pathname.split("/").at(-1);
    return jsonResponse(fileId ? this.files.get(fileId) : undefined);
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}
