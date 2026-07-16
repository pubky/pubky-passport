import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import type { PassportFileEnvelopeV1 } from "../../../core/domain/passport-file/passportFile";
import { GoogleDrivePassportFileRepository } from "./googleDrivePassportFileRepository";

const accessToken = "test-drive-access-token";
const envelope: PassportFileEnvelopeV1 = {
  v: 1,
  iv: "iv_value",
  ct: "ct_value",
  url: "https://passport.pubky.app",
};

type FetchCall = {
  url: string;
  init: RequestInit;
};

type ByteChunk = Uint8Array<ArrayBuffer>;

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

function createRepository(responses: Array<Response | Error>, options: { allowLocalhostHttp?: boolean } = {}) {
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
  expect(call.init.headers).toMatchObject({ Authorization: expect.stringMatching(/^Bearer /) });
}

function parseJsonBody(body: BodyInit | null | undefined): unknown {
  expect(typeof body).toBe("string");
  return JSON.parse(body as string);
}

function expectCall(calls: FetchCall[], index: number): FetchCall {
  const call = calls[index];
  expect(call).toBeDefined();
  return call as FetchCall;
}

describe("GoogleDrivePassportFileRepository", () => {
  it("returns missing when Drive list has no passport file", async () => {
    const { repository, calls } = createRepository([jsonResponse({ files: [] })]);

    await expect(repository.readPassportFile()).resolves.toEqual({ ok: true, value: { status: "missing" } });

    expect(calls).toHaveLength(1);
    const listCall = expectCall(calls, 0);
    expect(listCall.url).toContain("https://www.googleapis.com/drive/v3/files?");
    const listParams = new URL(listCall.url).searchParams;
    expect(listParams.get("spaces")).toBe("appDataFolder");
    expect(listParams.get("pageSize")).toBe("2");
    expect(listParams.get("q")).toBe("name = 'passport.json' and trashed = false");
    expectAuthorizationHeader(listCall);
  });

  it("reads and parses an encrypted v1 envelope from Drive media", async () => {
    const { repository, calls } = createRepository([
      jsonResponse({ files: [{ id: "file-1", name: "passport.json" }] }),
      textResponse(JSON.stringify(envelope)),
    ]);

    await expect(repository.readPassportFile()).resolves.toEqual({
      ok: true,
      value: { status: "found", envelope },
    });

    expect(calls).toHaveLength(2);
    const mediaCall = expectCall(calls, 1);
    expect(mediaCall.url).toBe("https://www.googleapis.com/drive/v3/files/file-1?alt=media");
    expectAuthorizationHeader(mediaCall);
  });

  it("maps malformed Drive envelope contents to a safe invalid_file error", async () => {
    const { repository } = createRepository([
      jsonResponse({ files: [{ id: "file-1", name: "passport.json" }] }),
      textResponse(JSON.stringify({ ...envelope, secret: "do-not-return" })),
    ]);

    const result = await repository.readPassportFile();

    expect(result).toEqual({ ok: false, error: { code: "invalid_file" } });
    expect(JSON.stringify(result)).not.toContain("do-not-return");
  });

  it("rejects an oversized Drive media response before reading it", async () => {
    const cancel = vi.fn();
    const { repository } = createRepository([
      jsonResponse({ files: [{ id: "file-1", name: "passport.json" }] }),
      oversizedMediaResponse(cancel),
    ]);

    await expect(repository.readPassportFile()).resolves.toEqual({ ok: false, error: { code: "invalid_file" } });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects streamed Drive media that exceeds the size limit", async () => {
    const cancel = vi.fn();
    const { repository } = createRepository([
      jsonResponse({ files: [{ id: "file-1", name: "passport.json" }] }),
      streamResponse([new Uint8Array(16 * 1024), new Uint8Array(1)], cancel),
    ]);

    await expect(repository.readPassportFile()).resolves.toEqual({ ok: false, error: { code: "invalid_file" } });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("maps Drive authorization failures safely", async () => {
    await expect(createRepository([jsonResponse({ error: "token" }, 401)]).repository.readPassportFile()).resolves.toEqual({
      ok: false,
      error: { code: "unauthorized" },
    });

    await expect(createRepository([jsonResponse({ error: "scope" }, 403)]).repository.readPassportFile()).resolves.toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  it("maps token provider and network failures safely", async () => {
    const unauthorizedRepository = new GoogleDrivePassportFileRepository({
      accessTokenProvider: async () => "",
      fetch: (async () => jsonResponse({ files: [] })) as typeof fetch,
    });
    await expect(unauthorizedRepository.readPassportFile()).resolves.toEqual({
      ok: false,
      error: { code: "unauthorized" },
    });

    const { repository } = createRepository([new Error("network includes secret details")]);
    const result = await repository.readPassportFile();

    expect(result).toEqual({ ok: false, error: { code: "network_failed" } });
    expect(JSON.stringify(result)).not.toContain("secret details");
  });

  it("rejects duplicate or paginated Drive matches", async () => {
    await expect(
      createRepository([
        jsonResponse({
          files: [
            { id: "file-1", name: "passport.json" },
            { id: "file-2", name: "passport.json" },
          ],
        }),
      ]).repository.readPassportFile(),
    ).resolves.toEqual({ ok: false, error: { code: "duplicate_files" } });

    await expect(
      createRepository([jsonResponse({ files: [{ id: "file-1", name: "passport.json" }], nextPageToken: "more" })]).repository
        .readPassportFile(),
    ).resolves.toEqual({ ok: false, error: { code: "duplicate_files" } });
  });

  it("treats a listed file that disappears before media read as missing", async () => {
    const { repository } = createRepository([
      jsonResponse({ files: [{ id: "file-1", name: "passport.json" }] }),
      textResponse("not found", 404),
    ]);

    await expect(repository.readPassportFile()).resolves.toEqual({ ok: true, value: { status: "missing" } });
  });

  it("creates passport.json in appDataFolder when no file exists", async () => {
    const { repository, calls } = createRepository([jsonResponse({ files: [] }), jsonResponse({ id: "created" })]);

    await expect(repository.writePassportFile({ envelope })).resolves.toEqual({ ok: true, value: undefined });

    expect(calls).toHaveLength(2);
    const createCall = expectCall(calls, 1);
    expect(createCall.url).toBe("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart");
    expect(createCall.init.method).toBe("POST");
    expect(createCall.init.headers).toMatchObject({ "Content-Type": expect.stringContaining("multipart/related") });
    expectAuthorizationHeader(createCall);

    const body = String(createCall.init.body);
    expect(body).toContain(JSON.stringify({ name: "passport.json", parents: ["appDataFolder"] }));
    expect(body).toContain(JSON.stringify(envelope));
    expect(body).not.toContain("secretKeyBytes");
    expect(body).not.toContain("wrappingKey");
  });

  it("updates existing passport.json media", async () => {
    const { repository, calls } = createRepository([
      jsonResponse({ files: [{ id: "file-1", name: "passport.json" }] }),
      jsonResponse({ id: "file-1" }),
    ]);

    await expect(repository.writePassportFile({ envelope })).resolves.toEqual({ ok: true, value: undefined });

    expect(calls).toHaveLength(2);
    const updateCall = expectCall(calls, 1);
    expect(updateCall.url).toBe("https://www.googleapis.com/upload/drive/v3/files/file-1?uploadType=media");
    expect(updateCall.init.method).toBe("PATCH");
    expect(updateCall.init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(parseJsonBody(updateCall.init.body)).toEqual(envelope);
  });

  it("serializes outbound envelopes through parser normalization", async () => {
    const localhostEnvelope = { ...envelope, url: "http://localhost:3000/" };
    const { repository, calls } = createRepository([jsonResponse({ files: [] }), jsonResponse({ id: "created" })], {
      allowLocalhostHttp: true,
    });

    await expect(repository.writePassportFile({ envelope: localhostEnvelope })).resolves.toEqual({ ok: true, value: undefined });

    expect(String(expectCall(calls, 1).init.body)).toContain(
      JSON.stringify({ ...localhostEnvelope, url: "http://localhost:3000" }),
    );
  });

  it("rejects invalid outbound envelopes without writing", async () => {
    const { repository, calls } = createRepository([jsonResponse({ files: [] })]);

    await expect(repository.writePassportFile({ envelope: { ...envelope, url: "https://passport.pubky.app/path" } })).resolves.toEqual({
      ok: false,
      error: { code: "invalid_file" },
    });
    expect(calls).toHaveLength(0);
  });

  it("maps Drive write failures without exposing response bodies", async () => {
    const { repository } = createRepository([
      jsonResponse({ files: [] }),
      jsonResponse({ error: "google raw error with token-ish details" }, 500),
    ]);

    const result = await repository.writePassportFile({ envelope });

    expect(result).toEqual({ ok: false, error: { code: "write_failed" } });
    expect(JSON.stringify(result)).not.toContain("google raw error");
  });

  it("maps an existing file disappearing before update to a write failure", async () => {
    const { repository } = createRepository([
      jsonResponse({ files: [{ id: "file-1", name: "passport.json" }] }),
      jsonResponse({ error: "not found" }, 404),
    ]);

    await expect(repository.writePassportFile({ envelope })).resolves.toEqual({
      ok: false,
      error: { code: "write_failed" },
    });
  });

  it("does not use browser persistence APIs", () => {
    const source = readFileSync(fileURLToPath(new URL("./googleDrivePassportFileRepository.ts", import.meta.url)), "utf8");

    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("indexedDB");
  });
});
