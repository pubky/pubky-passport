import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Result, type Result as ResultType } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { expectAsyncResultError, expectResultOk } from "../../../test-utils/resultAssertions";
import type { PassportFileEnvelopeV1 } from "../../core/passport-file/passportFile";
import {
  GoogleDrivePassportFileRepository,
  type PassportFileCreateLockManager,
} from "./googleDrivePassportFileRepository";

const accessToken = "test-drive-access-token";
const envelope: PassportFileEnvelopeV1 = {
  v: 1,
  iv: "iv_value",
  ct: "ct_value",
  url: "https://passport.pubky.app",
};
const reference = { storageId: "file-1", revision: "7" };
const listedFile = { id: "file-1", name: "passport.json", version: "7" };
const exactFile = { ...listedFile, trashed: false };

type FetchCall = {
  url: string;
  init: RequestInit;
};

type ByteChunk = Uint8Array<ArrayBuffer>;

class FakeLockManager implements PassportFileCreateLockManager {
  readonly names: string[] = [];
  maximumActive = 0;
  private active = 0;
  private tail = Promise.resolve();

  async request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    this.names.push(name);
    const previous = this.tail;
    let release = (): void => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    try {
      return await callback();
    } finally {
      this.active -= 1;
      release();
    }
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

function oversizedMediaResponse(onCancel?: () => void): Response {
  return new Response(cancellableStream([new TextEncoder().encode("oversized")], onCancel), {
    headers: { "Content-Length": String(16 * 1024 + 1) },
  });
}

function streamResponse(chunks: ByteChunk[], onCancel?: () => void): Response {
  return new Response(cancellableStream(chunks, onCancel));
}

function cancellableStream(chunks: ByteChunk[], onCancel?: () => void): ReadableStream<ByteChunk> {
  const source: UnderlyingDefaultSource<ByteChunk> = {
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
    },
  };

  if (onCancel !== undefined) {
    source.cancel = onCancel;
  }

  return new ReadableStream(source);
}

function createRepository(
  responses: Array<Response | Error>,
  options: { lockManager?: PassportFileCreateLockManager | null } = {},
) {
  const calls: FetchCall[] = [];
  const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {} });
    const response = responses.shift();
    if (!response) {
      throw new Error("Unexpected fetch call.");
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }) as typeof fetch;

  const repository = new GoogleDrivePassportFileRepository({
    accessTokenProvider: async () => accessToken,
    fetch: fetchMock,
    ...options,
  });

  return { repository, calls };
}

function expectAuthorizationHeader(call: FetchCall): void {
  expect(call.init.headers).toMatchObject({ Authorization: "Bearer " + accessToken });
}

function expectCall(calls: FetchCall[], index: number): FetchCall {
  const call = calls[index];
  expect(call).toBeDefined();
  return call as FetchCall;
}

async function expectSuccess<T>(result: Promise<ResultType<T, unknown>>, value: T): Promise<void> {
  expect(expectResultOk(await result)).toEqual(value);
}

async function expectFailure(result: Promise<ResultType<unknown, { code: string }>>, code: string): Promise<void> {
  await expectAsyncResultError(result, { code });
}

describe("GoogleDrivePassportFileRepository", () => {
  it("returns missing when Drive list has no passport file", async () => {
    const { repository, calls } = createRepository([jsonResponse({ files: [] })]);

    await expectSuccess(repository.readPassportFile(), { status: "missing" });

    expect(calls).toHaveLength(1);
    const listCall = expectCall(calls, 0);
    expect(listCall.url).toContain("https://www.googleapis.com/drive/v3/files?");
    const listParams = new URL(listCall.url).searchParams;
    expect(listParams.get("spaces")).toBe("appDataFolder");
    expect(listParams.get("pageSize")).toBe("2");
    expect(listParams.get("q")).toBe("name = 'passport.json' and trashed = false");
    expect(listParams.get("fields")).toBe("nextPageToken,files(id,name,version)");
    expectAuthorizationHeader(listCall);
  });

  it("reads and parses an encrypted v1 envelope from Drive media", async () => {
    const { repository, calls } = createRepository([
      jsonResponse({ files: [listedFile] }),
      textResponse(JSON.stringify(envelope)),
      jsonResponse(exactFile),
    ]);

    await expectSuccess(repository.readPassportFile(), { status: "found", envelope, reference });

    expect(calls).toHaveLength(3);
    const mediaCall = expectCall(calls, 1);
    expect(mediaCall.url).toBe("https://www.googleapis.com/drive/v3/files/file-1?alt=media");
    expectAuthorizationHeader(mediaCall);
    const metadataCall = expectCall(calls, 2);
    expect(new URL(metadataCall.url).searchParams.get("fields")).toBe("id,name,version,trashed");
  });

  it("maps malformed Drive envelope contents to a safe invalid_file error", async () => {
    const { repository } = createRepository([
      jsonResponse({ files: [listedFile] }),
      textResponse(JSON.stringify({ ...envelope, secret: "do-not-return" })),
    ]);

    const result = await repository.readPassportFile();

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({ code: "invalid_file" });
    }
    expect(JSON.stringify(result)).not.toContain("do-not-return");
  });

  it("rejects an oversized Drive media response before reading it", async () => {
    const cancel = vi.fn();
    const { repository } = createRepository([
      jsonResponse({ files: [listedFile] }),
      oversizedMediaResponse(cancel),
    ]);

    await expectFailure(repository.readPassportFile(), "invalid_file");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects an oversized Drive list response before reading it", async () => {
    const cancel = vi.fn();
    const { repository } = createRepository([oversizedMediaResponse(cancel)]);

    await expectFailure(repository.readPassportFile(), "invalid_response");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects streamed Drive list data that exceeds the size limit", async () => {
    const cancel = vi.fn();
    const { repository } = createRepository([streamResponse([new Uint8Array(16 * 1024), new Uint8Array(1)], cancel)]);

    await expectFailure(repository.readPassportFile(), "invalid_response");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects streamed Drive media that exceeds the size limit", async () => {
    const cancel = vi.fn();
    const { repository } = createRepository([
      jsonResponse({ files: [listedFile] }),
      streamResponse([new Uint8Array(16 * 1024), new Uint8Array(1)], cancel),
    ]);

    await expectFailure(repository.readPassportFile(), "invalid_file");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("maps Drive authorization failures safely", async () => {
    await expectFailure(createRepository([jsonResponse({ error: "token" }, 401)]).repository.readPassportFile(), "unauthorized");

    await expectFailure(createRepository([jsonResponse({ error: "scope" }, 403)]).repository.readPassportFile(), "forbidden");
  });

  it("maps token provider and network failures safely", async () => {
    const unauthorizedRepository = new GoogleDrivePassportFileRepository({
      accessTokenProvider: async () => "",
      fetch: (async () => jsonResponse({ files: [] })) as typeof fetch,
    });
    await expectFailure(unauthorizedRepository.readPassportFile(), "unauthorized");

    const { repository } = createRepository([new Error("network includes secret details")]);
    const result = await repository.readPassportFile();

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({ code: "network_failed" });
    }
    expect(JSON.stringify(result)).not.toContain("secret details");
  });

  it("rejects duplicate or paginated Drive matches", async () => {
    await expectFailure(createRepository([
      jsonResponse({
        files: [
          listedFile,
          { id: "file-2", name: "passport.json", version: "1" },
        ],
      }),
    ]).repository.readPassportFile(), "duplicate_files");

    await expectFailure(createRepository([jsonResponse({ files: [listedFile], nextPageToken: "more" })]).repository.readPassportFile(), "duplicate_files");
  });

  it("rejects a Drive list response for a different file", async () => {
    const { repository, calls } = createRepository([jsonResponse({ files: [{ id: "other-file", name: "other.json" }] })]);

    await expectFailure(repository.readPassportFile(), "invalid_response");

    expect(calls).toHaveLength(1);
  });

  it("returns stale_file when a listed file disappears before media read", async () => {
    const { repository } = createRepository([
      jsonResponse({ files: [listedFile] }),
      textResponse("not found", 404),
    ]);

    await expectFailure(repository.readPassportFile(), "stale_file");
  });

  it.each([
    ["version", { ...exactFile, version: "8" }],
    ["name", { ...exactFile, name: "renamed.json" }],
    ["trashed", { ...exactFile, trashed: true }],
  ])("returns stale_file when exact metadata changes by %s after media read", async (_field, metadata) => {
    const { repository } = createRepository([
      jsonResponse({ files: [listedFile] }),
      textResponse(JSON.stringify(envelope)),
      jsonResponse(metadata),
    ]);

    await expectFailure(repository.readPassportFile(), "stale_file");
  });

  it("requires Drive version on list and exact metadata responses", async () => {
    await expectFailure(createRepository([
      jsonResponse({ files: [{ id: "file-1", name: "passport.json" }] }),
    ]).repository.readPassportFile(), "invalid_response");

    await expectFailure(createRepository([
      jsonResponse({ files: [listedFile] }),
      textResponse(JSON.stringify(envelope)),
      jsonResponse({ id: "file-1", name: "passport.json", trashed: false }),
    ]).repository.readPassportFile(), "invalid_response");
  });

  it("creates passport.json in appDataFolder when no file exists", async () => {
    const created = { id: "created", name: "passport.json", version: "1" };
    const { repository, calls } = createRepository([
      jsonResponse({ files: [] }),
      jsonResponse(created),
      jsonResponse({ files: [created] }),
    ]);

    await expectSuccess(repository.createPassportFile({ envelope }), { storageId: "created", revision: "1" });

    expect(calls).toHaveLength(3);
    const createCall = expectCall(calls, 1);
    const createUrl = new URL(createCall.url);
    expect(createUrl.origin + createUrl.pathname).toBe("https://www.googleapis.com/upload/drive/v3/files");
    expect(createUrl.searchParams.get("uploadType")).toBe("multipart");
    expect(createUrl.searchParams.get("fields")).toBe("id,name,version");
    expect(createCall.init.method).toBe("POST");
    expect(createCall.init.headers).toMatchObject({ "Content-Type": expect.stringContaining("multipart/related") });
    expectAuthorizationHeader(createCall);

    const body = String(createCall.init.body);
    expect(body).toContain(JSON.stringify({ name: "passport.json", parents: ["appDataFolder"] }));
    expect(body).toContain(JSON.stringify(envelope));
    expect(body).not.toContain("secretKeyBytes");
    expect(body).not.toContain("wrappingKey");
  });

  it("serializes concurrent creates under one named browser lock", async () => {
    const lockManager = new FakeLockManager();
    const created = { id: "created", name: "passport.json", version: "1" };
    const calls: FetchCall[] = [];
    let stored = false;
    let createCount = 0;
    const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const call = { url: String(input), init: init ?? {} };
      calls.push(call);
      if (call.init.method === "POST") {
        createCount += 1;
        stored = true;
        return jsonResponse(created);
      }
      return jsonResponse({ files: stored ? [created] : [] });
    }) as typeof fetch;
    const createLockedRepository = () => new GoogleDrivePassportFileRepository({
      accessTokenProvider: async () => accessToken,
      fetch: fetchMock,
      lockManager,
    });

    const firstCreate = createLockedRepository().createPassportFile({ envelope });
    const secondCreate = createLockedRepository().createPassportFile({ envelope });
    const [first, second] = await Promise.all([firstCreate, secondCreate]);

    expect(expectResultOk(first)).toEqual({ storageId: "created", revision: "1" });
    expect(Result.isError(second) && second.error).toEqual({ code: "create_conflict" });
    expect(createCount).toBe(1);
    expect(calls.filter((call) => call.init.method === "POST")).toHaveLength(1);
    expect(lockManager.names).toHaveLength(2);
    expect(new Set(lockManager.names).size).toBe(1);
    expect(lockManager.maximumActive).toBe(1);
  });

  it("creates without locking when Web Locks are unavailable", async () => {
    const created = { id: "created", name: "passport.json", version: "1" };
    const { repository, calls } = createRepository([
      jsonResponse({ files: [] }),
      jsonResponse(created),
      jsonResponse({ files: [created] }),
    ], { lockManager: null });

    await expectSuccess(repository.createPassportFile({ envelope }), { storageId: "created", revision: "1" });
    expect(calls).toHaveLength(3);
  });

  it("rejects create when passport.json already exists without PATCHing it", async () => {
    const { repository, calls } = createRepository([jsonResponse({ files: [listedFile] })]);

    await expectFailure(repository.createPassportFile({ envelope }), "create_conflict");

    expect(calls).toHaveLength(1);
    expect(calls.some((call) => call.init.method === "PATCH")).toBe(false);
  });

  it("maps duplicate files found before create to create_conflict", async () => {
    const { repository, calls } = createRepository([jsonResponse({
      files: [listedFile, { ...listedFile, id: "file-2" }],
    })]);

    await expectFailure(repository.createPassportFile({ envelope }), "create_conflict");
    expect(calls).toHaveLength(1);
  });

  it("maps a conflicting post-create list check without PATCHing either file", async () => {
    const created = { id: "created", name: "passport.json", version: "1" };
    const { repository, calls } = createRepository([
      jsonResponse({ files: [] }),
      jsonResponse(created),
      jsonResponse({ files: [created, { ...listedFile, id: "racing-create" }] }),
    ]);

    await expectFailure(repository.createPassportFile({ envelope }), "create_conflict");
    expect(calls.some((call) => call.init.method === "PATCH")).toBe(false);
  });

  it("revalidates and deletes the exact referenced passport file", async () => {
    const { repository, calls } = createRepository([
      jsonResponse(exactFile),
      new Response(null, { status: 204 }),
    ]);

    await expectSuccess(repository.deletePassportFile({ reference }), undefined);

    expect(calls).toHaveLength(2);
    const deleteCall = expectCall(calls, 1);
    expect(deleteCall.url).toBe("https://www.googleapis.com/drive/v3/files/file-1");
    expect(deleteCall.init.method).toBe("DELETE");
    expectAuthorizationHeader(deleteCall);
  });

  it("treats an exact referenced file 404 as idempotent deletion", async () => {
    const { repository, calls } = createRepository([new Response(null, { status: 404 })]);

    await expectSuccess(repository.deletePassportFile({ reference }), undefined);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/files/file-1?");
  });

  it("treats a delete 404 after exact metadata validation as idempotent", async () => {
    const { repository, calls } = createRepository([
      jsonResponse(exactFile),
      new Response(null, { status: 404 }),
    ]);

    await expectSuccess(repository.deletePassportFile({ reference }), undefined);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.init.method).toBe("DELETE");
  });

  it.each([
    ["version", { ...exactFile, version: "8" }],
    ["name", { ...exactFile, name: "renamed.json" }],
    ["trashed", { ...exactFile, trashed: true }],
  ])("rejects deletion when exact metadata has stale %s", async (_field, metadata) => {
    const { repository, calls } = createRepository([jsonResponse(metadata)]);

    await expectFailure(repository.deletePassportFile({ reference }), "stale_file");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBeUndefined();
  });

  it("serializes outbound envelopes through parser normalization", async () => {
    const rootPathEnvelope = { ...envelope, url: "https://passport.pubky.app/" };
    const created = { id: "created", name: "passport.json", version: "1" };
    const { repository, calls } = createRepository([
      jsonResponse({ files: [] }),
      jsonResponse(created),
      jsonResponse({ files: [created] }),
    ]);

    await expectSuccess(repository.createPassportFile({ envelope: rootPathEnvelope }), { storageId: "created", revision: "1" });

    expect(String(expectCall(calls, 1).init.body)).toContain(
      JSON.stringify({ ...rootPathEnvelope, url: "https://passport.pubky.app" }),
    );
  });

  it("rejects invalid outbound envelopes without writing", async () => {
    const { repository, calls } = createRepository([jsonResponse({ files: [] })]);

    await expectFailure(repository.createPassportFile({ envelope: { ...envelope, url: "https://passport.pubky.app/path" } }), "invalid_file");
    expect(calls).toHaveLength(0);
  });

  it("maps Drive write failures without exposing response bodies", async () => {
    const { repository } = createRepository([
      jsonResponse({ files: [] }),
      jsonResponse({ error: "google raw error with token-ish details" }, 500),
    ]);

    const result = await repository.createPassportFile({ envelope });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({ code: "write_failed" });
    }
    expect(JSON.stringify(result)).not.toContain("google raw error");
  });

  it("does not use browser persistence APIs", () => {
    const source = readFileSync(fileURLToPath(new URL("./googleDrivePassportFileRepository.ts", import.meta.url)), "utf8");

    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("indexedDB");
  });
});
