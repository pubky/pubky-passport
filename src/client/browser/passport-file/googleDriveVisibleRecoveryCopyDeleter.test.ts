import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { GoogleDriveVisibleRecoveryCopyDeleter } from "./googleDriveVisibleRecoveryCopyDeleter";

const TOKEN = "SECRET-DRIVE-TOKEN";
const PUBLIC_KEY = "pubky1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const FILE_NAME = `${PUBLIC_KEY}.json`;
const FOLDER = {
  id: "folder-1",
  name: "Pubky Passport",
  mimeType: "application/vnd.google-apps.folder",
  parents: ["root"],
  trashed: false,
};

describe("GoogleDriveVisibleRecoveryCopyDeleter", () => {
  it("deletes every same-name recovery copy across all Passport folders", async () => {
    const calls: SanitizedCall[] = [];
    const deleter = createDeleter([
      jsonResponse({ files: [FOLDER, { ...FOLDER, id: "folder-2" }] }),
      jsonResponse({ files: [visibleFile("copy-1", "folder-1"), visibleFile("copy-2", "folder-1")] }),
      emptyResponse(),
      emptyResponse(),
      jsonResponse({ files: [visibleFile("copy-3", "folder-2")] }),
      emptyResponse(),
    ], calls);

    const result = await deleter.deleteVisibleRecoveryCopies(TOKEN, PUBLIC_KEY);

    expect(Result.isOk(result) && result.value).toEqual({ deletedCount: 3 });
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
    const deleter = createDeleter([
      jsonResponse({ files: [FOLDER] }),
      jsonResponse({ files: [visibleFile("copy-1", "folder-1")], nextPageToken: "next-page" }),
      jsonResponse({ files: [visibleFile("copy-2", "folder-1")] }),
      emptyResponse(),
      emptyResponse(),
    ], calls);

    const result = await deleter.deleteVisibleRecoveryCopies(TOKEN, PUBLIC_KEY);

    expect(Result.isOk(result) && result.value.deletedCount).toBe(2);
    expect(calls.find((call) => call.pageToken === "next-page")).toBeDefined();
  });

  it("stops and reports failure when any visible copy cannot be deleted", async () => {
    const deleter = createDeleter([
      jsonResponse({ files: [FOLDER] }),
      jsonResponse({ files: [visibleFile("copy-1", "folder-1"), visibleFile("copy-2", "folder-1")] }),
      emptyResponse(),
      jsonResponse({}, 403),
    ]);

    const result = await deleter.deleteVisibleRecoveryCopies(TOKEN, PUBLIC_KEY);

    expect(Result.isError(result) && result.error).toEqual({ code: "forbidden" });
  });

  it("rejects an invalid Pubky before accessing Drive", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const deleter = new GoogleDriveVisibleRecoveryCopyDeleter({ fetch });

    const result = await deleter.deleteVisibleRecoveryCopies(TOKEN, "not-a-pubky");

    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_file" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

type SanitizedCall = {
  method: string;
  fileId: string | null;
  pageToken: string | null;
  hasExpectedToken: boolean;
};

function createDeleter(responses: Response[], calls: SanitizedCall[] = []) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({
      method: init?.method ?? "GET",
      fileId: init?.method === "DELETE" ? url.pathname.split("/").at(-1) ?? null : null,
      pageToken: url.searchParams.get("pageToken"),
      hasExpectedToken: new Headers(init?.headers).get("Authorization") === `Bearer ${TOKEN}`,
    });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected Drive request");
    return response;
  }) as typeof globalThis.fetch;
  return new GoogleDriveVisibleRecoveryCopyDeleter({ fetch });
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
