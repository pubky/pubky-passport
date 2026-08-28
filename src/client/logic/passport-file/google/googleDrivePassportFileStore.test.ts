import { Result, type Result as ResultType } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectAsyncResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../../libs/logger/logger";
import type { PassportFileEnvelope } from "../passportFileEnvelope";
import { GoogleDrivePassportFileStore } from "./GoogleDrivePassportFileStore";

const ACCESS_TOKEN = "test-drive-access-token";
const ENVELOPE: PassportFileEnvelope = {
  v: 1,
  keyId: "current",
  iv: "AAECAwQFBgcICQoL",
  ct: "YZy1I_a6WzFnql8rW2A94EJrgz38Sqd1LV_KjVe2Qd2n1mvFMXg9qzRHwJ_WQvrm",
  url: "https://passport.pubky.app",
};
const INVALID_LENGTH_ENVELOPE = {
  ...ENVELOPE,
  iv: "abc123_-",
  ct: "ciphertext_123-ABC",
};
const REFERENCE = { storageId: "file-1", revision: "opaque-revision-7" };
const LISTED_FILE = { id: "file-1", name: "passport.json", version: "opaque-revision-7" };
const EXACT_FILE = { ...LISTED_FILE, trashed: false };
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type FetchCall = {
  endpoint: string;
  path: string;
  query: Record<string, string>;
  method: string;
  headerNames: string[];
  hasBearerToken: boolean;
  body: {
    byteLength: number;
    mediaType: string | null;
    shape: "none" | "multipart-passport-file" | "other";
    hasPassportMetadata: boolean;
    hasEnvelope: boolean;
    normalizedEnvelopeUrl: string | null;
    hasForbiddenSecretField: boolean;
  };
  hasSignal: boolean;
  order: number;
};

type ByteChunk = Uint8Array<ArrayBuffer>;

class RecordingLockManager {
  names: string[] = [];
  maximumActive = 0;
  private active = 0;
  private tail = Promise.resolve();

  async request<LockResult>(
    name: string,
    callback: () => Promise<LockResult>,
  ): Promise<LockResult> {
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

function createStore(responses: Array<Response | Error>) {
  const calls: FetchCall[] = [];
  const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push(sanitizeFetchCall(input, init, calls.length));
    const response = responses.shift();
    if (!response) {
      throw new Error("Unexpected fetch call.");
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }) as typeof fetch;

  const store = new GoogleDrivePassportFileStore(ACCESS_TOKEN, fetchMock);

  return { store, calls };
}

function expectAuthorizationHeader(call: FetchCall): void {
  expect(call.headerNames).toContain("authorization");
  expect(call.hasBearerToken).toBe(true);
}

function expectCall(calls: FetchCall[], index: number): FetchCall {
  const call = calls[index];
  expect(call).toBeDefined();
  return call as FetchCall;
}

function sanitizeFetchCall(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  order: number,
): FetchCall {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input.toString() : input.url,
  );
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  const authorization = headers.get("authorization");
  const body = init?.body;
  const bodyText = typeof body === "string" ? body : null;
  const mediaType = headers.get("content-type");
  const isMultipartPassportFile =
    mediaType?.startsWith("multipart/related") === true &&
    bodyText?.includes(JSON.stringify({ name: "passport.json", parents: ["appDataFolder"] })) ===
      true;

  return {
    endpoint: url.origin,
    path: url.pathname.replace(/\/drive\/v3\/files\/[^/]+$/, "/drive/v3/files/:fileId"),
    query: Object.fromEntries(url.searchParams),
    method: init?.method ?? (input instanceof Request ? input.method : "GET"),
    headerNames: [...headers.keys()].map((name) => name.toLowerCase()).sort(),
    hasBearerToken: authorization?.startsWith("Bearer ") === true,
    body: {
      byteLength: bodyText === null ? 0 : new TextEncoder().encode(bodyText).byteLength,
      mediaType,
      shape:
        bodyText === null ? "none" : isMultipartPassportFile ? "multipart-passport-file" : "other",
      hasPassportMetadata: isMultipartPassportFile,
      hasEnvelope: bodyText?.includes(JSON.stringify(ENVELOPE)) === true,
      normalizedEnvelopeUrl:
        bodyText?.includes('"url":"https://passport.pubky.app"') === true
          ? "https://passport.pubky.app"
          : null,
      hasForbiddenSecretField:
        bodyText?.includes("secretKeyBytes") === true || bodyText?.includes("wrappingKey") === true,
    },
    hasSignal: init?.signal != null,
    order,
  };
}

function successfulCreateResponses(created: DriveTestFile): Response[] {
  return [jsonResponse({ files: [] }), jsonResponse(created), jsonResponse({ files: [created] })];
}

type DriveTestFile = { id: string; name: string; version: string };

function expectSanitizedCalls(calls: FetchCall[]): void {
  const serialized = JSON.stringify(calls);
  expect(serialized).not.toContain(ACCESS_TOKEN);
  expect(serialized).not.toContain(ENVELOPE.iv);
  expect(serialized).not.toContain(ENVELOPE.ct);
  expect(serialized).not.toContain(REFERENCE.storageId);
  expect(serialized).not.toContain(REFERENCE.revision);
}

async function expectSuccess<Success>(
  result: Promise<ResultType<Success, unknown>>,
  value: Success,
): Promise<void> {
  expect(expectResultOk(await result)).toEqual(value);
}

async function expectFailure(
  result: Promise<ResultType<unknown, { code: string }>>,
  code: string,
): Promise<void> {
  await expectAsyncResultError(result, { code });
}

describe("GoogleDrivePassportFileStore", () => {
  it("returns missing when Drive list has no passport file", async () => {
    const { store, calls } = createStore([jsonResponse({ files: [] })]);

    await expectSuccess(store.readPassportFile(), { status: "missing" });

    expect(calls).toHaveLength(1);
    const listCall = expectCall(calls, 0);
    expect(listCall.endpoint + listCall.path).toBe("https://www.googleapis.com/drive/v3/files");
    expect(listCall.query.spaces).toBe("appDataFolder");
    expect(listCall.query.pageSize).toBe("2");
    expect(listCall.query.q).toBe("name = 'passport.json' and trashed = false");
    expect(listCall.query.fields).toBe("nextPageToken,files(id,name,version)");
    expectAuthorizationHeader(listCall);
    expectSanitizedCalls(calls);
  });

  it("reads and parses an encrypted v1 envelope from Drive media", async () => {
    const { store, calls } = createStore([
      jsonResponse({ files: [LISTED_FILE] }),
      textResponse(JSON.stringify(ENVELOPE)),
      jsonResponse(EXACT_FILE),
    ]);

    await expectSuccess(store.readPassportFile(), {
      status: "found",
      envelope: ENVELOPE,
      reference: REFERENCE,
    });

    expect(calls).toHaveLength(3);
    const mediaCall = expectCall(calls, 1);
    expect(mediaCall.endpoint + mediaCall.path).toBe(
      "https://www.googleapis.com/drive/v3/files/:fileId",
    );
    expect(mediaCall.query.alt).toBe("media");
    expectAuthorizationHeader(mediaCall);
    const metadataCall = expectCall(calls, 2);
    expect(metadataCall.query.fields).toBe("id,name,version,trashed");
    expect(calls.some((call) => call.query.spaces === "drive")).toBe(false);
    expectSanitizedCalls(calls);
  });

  it("maps impossible cryptographic lengths to a safe invalid_file error", async () => {
    const { store } = createStore([
      jsonResponse({ files: [LISTED_FILE] }),
      textResponse(JSON.stringify(INVALID_LENGTH_ENVELOPE)),
    ]);

    const result = await store.readPassportFile();

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({ code: "invalid_file" });
    }
    expect(JSON.stringify(result)).not.toContain(INVALID_LENGTH_ENVELOPE.iv);
    expect(JSON.stringify(result)).not.toContain(INVALID_LENGTH_ENVELOPE.ct);
  });

  it("does not classify unsupported-version envelopes as deletable invalid files", async () => {
    await expectAsyncResultError(
      createStore([
        jsonResponse({ files: [LISTED_FILE] }),
        textResponse(JSON.stringify({ ...ENVELOPE, v: 3, futureField: true })),
      ]).store.readPassportFile(),
      {
        code: "unsupported_file",
        cause: { code: "unsupported_version" },
      },
    );

    const { store, calls } = createStore([
      jsonResponse({ files: [LISTED_FILE] }),
      textResponse(JSON.stringify({ ...ENVELOPE, v: 3, futureField: true })),
    ]);
    await expectAsyncResultError(store.deleteInvalidPassportFile(), {
      code: "unsupported_file",
      cause: { code: "unsupported_version" },
    });
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("revalidates and deletes an envelope with impossible cryptographic lengths", async () => {
    const { store, calls } = createStore([
      jsonResponse({ files: [LISTED_FILE] }),
      textResponse(JSON.stringify(INVALID_LENGTH_ENVELOPE)),
      jsonResponse(EXACT_FILE),
      new Response(null, { status: 204 }),
    ]);

    await expectSuccess(store.deleteInvalidPassportFile(), "deleted");

    expect(calls).toHaveLength(4);
    expect(calls[3]?.method).toBe("DELETE");
  });

  it("never deletes a file that became valid before confirmed replacement", async () => {
    const { store, calls } = createStore([
      jsonResponse({ files: [LISTED_FILE] }),
      textResponse(JSON.stringify(ENVELOPE)),
    ]);

    await expectFailure(store.deleteInvalidPassportFile(), "stale_file");

    expect(calls).toHaveLength(2);
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("returns missing when the invalid file was removed before confirmation", async () => {
    const { store, calls } = createStore([jsonResponse({ files: [] })]);

    await expectSuccess(store.deleteInvalidPassportFile(), "missing");
    expect(calls).toHaveLength(1);
  });

  it("does not classify an oversized Drive media response as safely deletable", async () => {
    const cancel = vi.fn();
    const { store } = createStore([
      jsonResponse({ files: [LISTED_FILE] }),
      oversizedMediaResponse(cancel),
    ]);

    await expectFailure(store.readPassportFile(), "unsupported_file");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects an oversized Drive list response before reading it", async () => {
    const cancel = vi.fn();
    const { store } = createStore([oversizedMediaResponse(cancel)]);

    await expectFailure(store.readPassportFile(), "invalid_response");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects streamed Drive list data that exceeds the size limit", async () => {
    const cancel = vi.fn();
    const { store } = createStore([
      streamResponse([new Uint8Array(16 * 1024), new Uint8Array(1)], cancel),
    ]);

    await expectFailure(store.readPassportFile(), "invalid_response");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not classify streamed oversized Drive media as safely deletable", async () => {
    const cancel = vi.fn();
    const { store } = createStore([
      jsonResponse({ files: [LISTED_FILE] }),
      streamResponse([new Uint8Array(16 * 1024), new Uint8Array(1)], cancel),
    ]);

    await expectFailure(store.readPassportFile(), "unsupported_file");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("maps Drive authorization failures safely", async () => {
    await expectFailure(
      createStore([jsonResponse({ error: "token" }, 401)]).store.readPassportFile(),
      "unauthorized",
    );

    await expectFailure(
      createStore([jsonResponse({ error: "scope" }, 403)]).store.readPassportFile(),
      "forbidden",
    );
  });

  it("maps empty tokens and network failures safely", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const emptyTokenStore = new GoogleDrivePassportFileStore("", (async () =>
      jsonResponse({ files: [] })) as typeof fetch);
    await expectFailure(emptyTokenStore.readPassportFile(), "unauthorized");
    expect(warning).toHaveBeenCalledWith("identity.google.drive_store.failed", {
      operation: "access_token",
      code: "unauthorized",
    });

    const cause = new Error("network includes secret details");
    const { store } = createStore([cause]);
    const result = await store.readPassportFile();

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.code).toBe("network_failed");
      expect(result.error.cause).toBe(cause);
    }
    expect(JSON.stringify(result)).not.toContain("secret details");
    expect(warning).toHaveBeenCalledWith("identity.google.drive_store.failed", {
      operation: "list",
      code: "network_failed",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("secret details");
    expect(JSON.stringify(warning.mock.calls)).not.toContain(ACCESS_TOKEN);
  });

  it("logs malformed Drive JSON without retaining response contents", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const { store } = createStore([textResponse("SECRET-MALFORMED-DRIVE-RESPONSE")]);

    await expectFailure(store.readPassportFile(), "invalid_response");

    expect(warning).toHaveBeenCalledWith("identity.google.drive_store.failed", {
      operation: "parse_list_response",
      code: "invalid_response",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-MALFORMED-DRIVE-RESPONSE");
    expect(JSON.stringify(warning.mock.calls)).not.toContain(ACCESS_TOKEN);
  });

  it("logs valid JSON with a malformed Drive response shape exactly once", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const { store } = createStore([jsonResponse({ files: "SECRET-NOT-AN-ARRAY" })]);

    await expectFailure(store.readPassportFile(), "invalid_response");

    expect(warning).toHaveBeenCalledWith("identity.google.drive_store.failed", {
      operation: "parse_list_response",
      code: "invalid_response",
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-NOT-AN-ARRAY");
  });

  it("rejects duplicate or paginated Drive matches", async () => {
    await expectFailure(
      createStore([
        jsonResponse({
          files: [LISTED_FILE, { id: "file-2", name: "passport.json", version: "1" }],
        }),
      ]).store.readPassportFile(),
      "duplicate_files",
    );

    await expectFailure(
      createStore([
        jsonResponse({ files: [LISTED_FILE], nextPageToken: "more" }),
      ]).store.readPassportFile(),
      "duplicate_files",
    );
  });

  it("rejects a Drive list response for a different file", async () => {
    const { store, calls } = createStore([
      jsonResponse({ files: [{ id: "other-file", name: "other.json" }] }),
    ]);

    await expectFailure(store.readPassportFile(), "invalid_response");

    expect(calls).toHaveLength(1);
  });

  it("returns stale_file when a listed file disappears before media read", async () => {
    const { store } = createStore([
      jsonResponse({ files: [LISTED_FILE] }),
      textResponse("not found", 404),
    ]);

    await expectFailure(store.readPassportFile(), "stale_file");
  });

  it("chains an exact metadata disappearance when remapping it to stale_file", async () => {
    const { store } = createStore([
      jsonResponse({ files: [LISTED_FILE] }),
      textResponse(JSON.stringify(ENVELOPE)),
      new Response(null, { status: 404 }),
    ]);

    await expectAsyncResultError(store.readPassportFile(), {
      code: "stale_file",
      cause: { code: "exact_file_missing" },
    });
  });

  it.each([
    ["version", { ...EXACT_FILE, version: "8" }],
    ["name", { ...EXACT_FILE, name: "renamed.json" }],
    ["trashed", { ...EXACT_FILE, trashed: true }],
  ])(
    "returns stale_file when exact metadata changes by %s after media read",
    async (_field, metadata) => {
      const { store } = createStore([
        jsonResponse({ files: [LISTED_FILE] }),
        textResponse(JSON.stringify(ENVELOPE)),
        jsonResponse(metadata),
      ]);

      await expectFailure(store.readPassportFile(), "stale_file");
    },
  );

  it("requires Drive version on list and exact metadata responses", async () => {
    await expectFailure(
      createStore([
        jsonResponse({ files: [{ id: "file-1", name: "passport.json" }] }),
      ]).store.readPassportFile(),
      "invalid_response",
    );

    await expectFailure(
      createStore([
        jsonResponse({ files: [LISTED_FILE] }),
        textResponse(JSON.stringify(ENVELOPE)),
        jsonResponse({ id: "file-1", name: "passport.json", trashed: false }),
      ]).store.readPassportFile(),
      "invalid_response",
    );
  });

  it("creates passport.json in appDataFolder when no file exists", async () => {
    const created = { id: "created", name: "passport.json", version: "1" };
    const { store, calls } = createStore(successfulCreateResponses(created));

    await expectSuccess(store.createPassportFile(ENVELOPE), undefined);

    expect(calls).toHaveLength(3);
    const createCall = expectCall(calls, 1);
    expect(createCall.endpoint + createCall.path).toBe(
      "https://www.googleapis.com/upload/drive/v3/files",
    );
    expect(createCall.query.uploadType).toBe("multipart");
    expect(createCall.query.fields).toBe("id,name,version");
    expect(createCall.method).toBe("POST");
    expect(createCall.headerNames).toContain("content-type");
    expectAuthorizationHeader(createCall);
    expect(createCall.body).toMatchObject({
      shape: "multipart-passport-file",
      hasPassportMetadata: true,
      hasEnvelope: true,
      normalizedEnvelopeUrl: "https://passport.pubky.app",
      hasForbiddenSecretField: false,
    });
    expect(createCall.body.byteLength).toBeGreaterThan(0);
    expect(calls.some((call) => call.query.spaces === "drive")).toBe(false);
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([]);
    expectSanitizedCalls(calls);
  });

  it("serializes concurrent creates under one named browser lock", async () => {
    const lockManager = new RecordingLockManager();
    const created = { id: "created", name: "passport.json", version: "1" };
    const calls: FetchCall[] = [];
    let stored = false;
    let createCount = 0;
    const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const call = sanitizeFetchCall(input, init, calls.length);
      calls.push(call);
      if (call.method === "POST" && call.body.hasPassportMetadata) {
        createCount += 1;
        stored = true;
        return jsonResponse(created);
      }
      return jsonResponse({ files: stored ? [created] : [] });
    }) as typeof fetch;
    const createLockedStore = () => new GoogleDrivePassportFileStore(ACCESS_TOKEN, fetchMock);
    vi.stubGlobal("navigator", { locks: lockManager });

    const firstCreate = createLockedStore().createPassportFile(ENVELOPE);
    const secondCreate = createLockedStore().createPassportFile(ENVELOPE);
    const [first, second] = await Promise.all([firstCreate, secondCreate]);

    expect(expectResultOk(first)).toBeUndefined();
    expect(Result.isError(second) && second.error).toEqual({ code: "create_conflict" });
    expect(createCount).toBe(1);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls.map((call) => call.order)).toEqual([0, 1, 2, 3]);
    expectSanitizedCalls(calls);
    expect(lockManager.names).toHaveLength(2);
    expect(new Set(lockManager.names).size).toBe(1);
    expect(lockManager.maximumActive).toBe(1);
  });

  it("creates without locking when Web Locks are unavailable", async () => {
    const created = { id: "created", name: "passport.json", version: "1" };
    vi.stubGlobal("navigator", {});
    const { store, calls } = createStore(successfulCreateResponses(created));

    await expectSuccess(store.createPassportFile(ENVELOPE), undefined);
    expect(calls).toHaveLength(3);
  });

  it("returns the exact browser lock cause without including it in logs", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = {
      message: "SECRET-LOCK-FAILURE",
      token: ACCESS_TOKEN,
      responseBody: "SECRET-RESPONSE-BODY",
      driveFile: LISTED_FILE,
      url: "https://secret.example/drive/file-1",
      identity: "SECRET-IDENTITY",
    };
    vi.stubGlobal("navigator", {
      locks: {
        request: async () => {
          throw cause;
        },
      },
    });
    const store = new GoogleDrivePassportFileStore(ACCESS_TOKEN, (async () =>
      jsonResponse({ files: [] })) as typeof fetch);

    const result = await store.createPassportFile(ENVELOPE);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.code).toBe("write_failed");
      expect(result.error.cause).toBe(cause);
    }

    expect(warning).toHaveBeenCalledWith("identity.google.drive_store.failed", {
      operation: "create_lock",
      code: "write_failed",
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls[0]?.[1]).not.toHaveProperty("cause");
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain("SECRET-LOCK-FAILURE");
    expect(logged).not.toContain("SECRET-RESPONSE-BODY");
    expect(logged).not.toContain(ACCESS_TOKEN);
    expect(logged).not.toContain(ENVELOPE.iv);
    expect(logged).not.toContain(ENVELOPE.ct);
    expect(logged).not.toContain("secret.example");
    expect(logged).not.toContain("SECRET-IDENTITY");
  });

  it("rejects create when passport.json already exists without PATCHing it", async () => {
    const { store, calls } = createStore([jsonResponse({ files: [LISTED_FILE] })]);

    await expectFailure(store.createPassportFile(ENVELOPE), "create_conflict");

    expect(calls).toHaveLength(1);
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("maps duplicate files found before create to create_conflict", async () => {
    const { store, calls } = createStore([
      jsonResponse({
        files: [LISTED_FILE, { ...LISTED_FILE, id: "file-2" }],
      }),
    ]);

    await expectAsyncResultError(store.createPassportFile(ENVELOPE), {
      code: "create_conflict",
      cause: { code: "duplicate_files" },
    });
    expect(calls).toHaveLength(1);
  });

  it("maps a conflicting post-create list check without PATCHing either file", async () => {
    const created = { id: "created", name: "passport.json", version: "1" };
    const { store, calls } = createStore([
      jsonResponse({ files: [] }),
      jsonResponse(created),
      jsonResponse({ files: [created, { ...LISTED_FILE, id: "racing-create" }] }),
    ]);

    await expectAsyncResultError(store.createPassportFile(ENVELOPE), {
      code: "create_conflict",
      cause: { code: "duplicate_files" },
    });
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("accepts the created file when Drive advances its server-managed version", async () => {
    const created = { id: "created", name: "passport.json", version: "1" };
    const { store } = createStore([
      jsonResponse({ files: [] }),
      jsonResponse(created),
      jsonResponse({ files: [{ ...created, version: "2" }] }),
    ]);

    await expectSuccess(store.createPassportFile(ENVELOPE), undefined);
  });

  it("maps a different post-create file ID to create_conflict", async () => {
    const created = { id: "created", name: "passport.json", version: "1" };
    const { store } = createStore([
      jsonResponse({ files: [] }),
      jsonResponse(created),
      jsonResponse({ files: [{ ...created, id: "racing-create", version: "2" }] }),
    ]);

    await expectFailure(store.createPassportFile(ENVELOPE), "create_conflict");
  });

  it("revalidates and deletes the exact referenced passport file", async () => {
    const { store, calls } = createStore([
      jsonResponse(EXACT_FILE),
      new Response(null, { status: 204 }),
    ]);

    await expectSuccess(store.deletePassportFile(REFERENCE), undefined);

    expect(calls).toHaveLength(2);
    const deleteCall = expectCall(calls, 1);
    expect(deleteCall.endpoint + deleteCall.path).toBe(
      "https://www.googleapis.com/drive/v3/files/:fileId",
    );
    expect(deleteCall.method).toBe("DELETE");
    expectAuthorizationHeader(deleteCall);
    expect(calls.some((call) => call.query.spaces === "drive")).toBe(false);
    expectSanitizedCalls(calls);
  });

  it("treats an exact referenced file 404 as idempotent deletion", async () => {
    const { store, calls } = createStore([new Response(null, { status: 404 })]);

    await expectSuccess(store.deletePassportFile(REFERENCE), undefined);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/drive/v3/files/:fileId");
    expectSanitizedCalls(calls);
  });

  it("treats a delete 404 after exact metadata validation as idempotent", async () => {
    const { store, calls } = createStore([
      jsonResponse(EXACT_FILE),
      new Response(null, { status: 404 }),
    ]);

    await expectSuccess(store.deletePassportFile(REFERENCE), undefined);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.method).toBe("DELETE");
  });

  it.each([
    ["version", { ...EXACT_FILE, version: "8" }],
    ["name", { ...EXACT_FILE, name: "renamed.json" }],
    ["trashed", { ...EXACT_FILE, trashed: true }],
  ])("rejects deletion when exact metadata has stale %s", async (_field, metadata) => {
    const { store, calls } = createStore([jsonResponse(metadata)]);

    await expectFailure(store.deletePassportFile(REFERENCE), "stale_file");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
  });

  it("serializes outbound envelopes through parser normalization", async () => {
    const rootPathEnvelope = { ...ENVELOPE, url: "https://passport.pubky.app/" };
    const created = { id: "created", name: "passport.json", version: "1" };
    const { store, calls } = createStore(successfulCreateResponses(created));

    await expectSuccess(store.createPassportFile(rootPathEnvelope), undefined);

    expect(expectCall(calls, 1).body.normalizedEnvelopeUrl).toBe("https://passport.pubky.app");
    expectSanitizedCalls(calls);
  });

  it("rejects invalid outbound envelopes without writing", async () => {
    const { store, calls } = createStore([jsonResponse({ files: [] })]);

    await expectFailure(
      store.createPassportFile({ ...ENVELOPE, url: "https://passport.pubky.app/path" }),
      "invalid_file",
    );
    expect(calls).toHaveLength(0);
  });

  it("maps Drive write failures without exposing response bodies", async () => {
    const { store } = createStore([
      jsonResponse({ files: [] }),
      jsonResponse({ error: "google raw error with token-ish details" }, 500),
    ]);

    const result = await store.createPassportFile(ENVELOPE);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({ code: "write_failed" });
    }
    expect(JSON.stringify(result)).not.toContain("google raw error");
  });
});
