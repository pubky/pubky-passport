import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../../../libs/logger/logger";
import { GoogleDriveVisibleRecoveryCopies } from "./GoogleDriveVisibleRecoveryCopies";

const TOKEN = "SECRET-DRIVE-TOKEN";
const PUBLIC_KEY_Z32 = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const PUBLIC_IDENTITY = { publicKeyZ32: PUBLIC_KEY_Z32, publicKeyDisplay: `pubky${PUBLIC_KEY_Z32}` };
const FILE_NAME = `${PUBLIC_IDENTITY.publicKeyDisplay}.json`;
const FOLDER = {
  id: "folder-1",
  name: "Pubky Passport",
  mimeType: "application/vnd.google-apps.folder",
  parents: ["root"],
  trashed: false,
};

afterEach(() => vi.restoreAllMocks());

describe("GoogleDriveVisibleRecoveryCopies deletion", () => {
  it("deletes every same-name recovery copy across all Passport folders", async () => {
    const calls: SanitizedCall[] = [];
    const visibleCopies = createVisibleCopies([
      jsonResponse({ files: [FOLDER, { ...FOLDER, id: "folder-2" }] }),
      jsonResponse({ files: [visibleFile("copy-1", "folder-1"), visibleFile("copy-2", "folder-1")] }),
      emptyResponse(),
      emptyResponse(),
      jsonResponse({ files: [visibleFile("copy-3", "folder-2")] }),
      emptyResponse(),
    ], calls);

    const result = await visibleCopies.deleteVisibleRecoveryCopies(PUBLIC_IDENTITY);

    expect(Result.isOk(result)).toBe(true);
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.fileId)).toEqual([
      "copy-1",
      "copy-2",
      "copy-3",
    ]);
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(3);
    expect(calls.every((call) => call.hasExpectedToken)).toBe(true);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
  });

  it("follows Drive pagination so old duplicate copies are not left behind", async () => {
    const calls: SanitizedCall[] = [];
    const visibleCopies = createVisibleCopies([
      jsonResponse({ files: [FOLDER] }),
      jsonResponse({ files: [visibleFile("copy-1", "folder-1")], nextPageToken: "next-page" }),
      jsonResponse({ files: [visibleFile("copy-2", "folder-1")] }),
      emptyResponse(),
      emptyResponse(),
    ], calls);

    const result = await visibleCopies.deleteVisibleRecoveryCopies(PUBLIC_IDENTITY);

    expect(Result.isOk(result)).toBe(true);
    expect(calls.find((call) => call.pageToken === "next-page")).toBeDefined();
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.fileId)).toEqual([
      "copy-1",
      "copy-2",
    ]);
  });

  it("requests at most 25 files per list page", async () => {
    const calls: SanitizedCall[] = [];
    const files = Array.from({ length: 25 }, (_, index) => visibleFile(`copy-${index}`, "folder-1"));
    const visibleCopies = createVisibleCopies([
      jsonResponse({ files: [FOLDER] }),
      jsonResponse({ files }),
      ...files.map(() => emptyResponse()),
    ], calls);

    const result = await visibleCopies.deleteVisibleRecoveryCopies(PUBLIC_IDENTITY);

    expect(Result.isOk(result)).toBe(true);
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(25);
    expect(calls.filter((call) => call.method === "GET").every((call) => call.pageSize === "25")).toBe(true);
  });

  it("stops and reports failure when any visible copy cannot be deleted", async () => {
    const visibleCopies = createVisibleCopies([
      jsonResponse({ files: [FOLDER] }),
      jsonResponse({ files: [visibleFile("copy-1", "folder-1"), visibleFile("copy-2", "folder-1")] }),
      emptyResponse(),
      jsonResponse({}, 403),
    ]);

    const result = await visibleCopies.deleteVisibleRecoveryCopies(PUBLIC_IDENTITY);

    expect(Result.isError(result) && result.error).toEqual({ code: "forbidden" });
  });

  it("rejects an oversized Drive list response before issuing another request", async () => {
    const calls: SanitizedCall[] = [];
    const response = new Response("{}", {
      headers: { "Content-Length": String(16 * 1024 + 1) },
    });
    const visibleCopies = createVisibleCopies([response], calls);

    const result = await visibleCopies.deleteVisibleRecoveryCopies(PUBLIC_IDENTITY);

    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_response" });
    expect(calls).toHaveLength(1);
  });

  it("rejects repeated pagination tokens", async () => {
    const calls: SanitizedCall[] = [];
    const visibleCopies = createVisibleCopies([
      jsonResponse({ files: [FOLDER], nextPageToken: "repeated-page" }),
      jsonResponse({ files: [], nextPageToken: "repeated-page" }),
    ], calls);

    const result = await visibleCopies.deleteVisibleRecoveryCopies(PUBLIC_IDENTITY);

    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_response" });
    expect(calls).toHaveLength(2);
  });

  it("stops before requesting a 101st list page", async () => {
    const calls: SanitizedCall[] = [];
    const responses = Array.from({ length: 100 }, (_, index) => (
      jsonResponse({ files: [], nextPageToken: `page-${index + 1}` })
    ));
    const visibleCopies = createVisibleCopies(responses, calls);

    const result = await visibleCopies.deleteVisibleRecoveryCopies(PUBLIC_IDENTITY);

    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_response" });
    expect(calls).toHaveLength(100);
  });

  it("logs deletion failures without retaining tokens or upstream bodies", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const visibleCopies = createVisibleCopies([
      new Response("SECRET-UPSTREAM-BODY", { status: 403 }),
    ]);

    const result = await visibleCopies.deleteVisibleRecoveryCopies(PUBLIC_IDENTITY);

    expect(Result.isError(result) && result.error).toEqual({ code: "forbidden" });
    expect(warning).toHaveBeenCalledWith("identity.google.visible_recovery_copies.failed", {
      operation: "list_folders",
      code: "forbidden",
    });
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain("SECRET-UPSTREAM-BODY");
  });

  it("returns the exact unexpected deletion cause without including it in logs", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = {
      message: "SECRET-DELETE-FAILURE",
      token: TOKEN,
      responseBody: "SECRET-RESPONSE-BODY",
      driveFile: FOLDER,
      url: "https://secret.example/drive/file-1",
      identity: PUBLIC_IDENTITY.publicKeyDisplay,
    };
    const response = new Response(null);
    Object.defineProperty(response, "ok", {
      get() {
        throw cause;
      },
    });
    const visibleCopies = createVisibleCopies([response]);

    const result = await visibleCopies.deleteVisibleRecoveryCopies(PUBLIC_IDENTITY);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.code).toBe("network_failed");
      expect(result.error.cause).toBe(cause);
    }
    expect(warning).toHaveBeenCalledWith("identity.google.visible_recovery_copies.failed", {
      operation: "delete_visible_copies",
      code: "network_failed",
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls[0]?.[1]).not.toHaveProperty("cause");
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain("SECRET-DELETE-FAILURE");
    expect(logged).not.toContain("SECRET-RESPONSE-BODY");
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(FOLDER.id);
    expect(logged).not.toContain("secret.example");
    expect(logged).not.toContain(PUBLIC_IDENTITY.publicKeyDisplay);
  });

  it("rejects an invalid Pubky before accessing Drive", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const visibleCopies = new GoogleDriveVisibleRecoveryCopies(TOKEN, fetch);

    const result = await visibleCopies.deleteVisibleRecoveryCopies({
      publicKeyZ32: "not-a-pubky",
      publicKeyDisplay: "not-a-pubky",
    });

    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_file" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

type SanitizedCall = {
  method: string;
  fileId: string | null;
  pageToken: string | null;
  pageSize: string | null;
  hasExpectedToken: boolean;
};

function createVisibleCopies(responses: Response[], calls: SanitizedCall[] = []) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({
      method: init?.method ?? "GET",
      fileId: init?.method === "DELETE" ? url.pathname.split("/").at(-1) ?? null : null,
      pageToken: url.searchParams.get("pageToken"),
      pageSize: url.searchParams.get("pageSize"),
      hasExpectedToken: new Headers(init?.headers).get("Authorization") === `Bearer ${TOKEN}`,
    });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected Drive request");
    return response;
  }) as typeof globalThis.fetch;
  return new GoogleDriveVisibleRecoveryCopies(TOKEN, fetch);
}

function visibleFile(id: string, folderId: string) {
  return { id, name: FILE_NAME, parents: [folderId], trashed: false };
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function emptyResponse(): Response {
  return new Response(null, { status: 204 });
}
