import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { HttpResponseError } from "../../../../libs/http/HttpResponseError";
import {
  createDriveHttpResponseFailure,
  fetchDrive,
  parseDriveFileRevision,
  sameDriveFileIdentity,
  sameDriveFileRevision,
} from "./driveHttp";

describe("fetchDrive", () => {
  it("enforces the Drive request policy without dropping caller options", async () => {
    const response = new Response();
    const signal = new AbortController().signal;
    let receivedInit: RequestInit | undefined;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      receivedInit = init;
      return response;
    }) as typeof fetch;

    const result = await fetchDrive(fetchImpl, "https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
      signal,
      cache: "force-cache",
      credentials: "include",
      redirect: "follow",
      referrerPolicy: "unsafe-url",
    });

    expect(Result.isError(result)).toBe(false);
    if (!Result.isError(result)) expect(result.value).toBe(response);
    expect(receivedInit).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer token" },
      signal,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  });

  it("preserves fetch failures as diagnostic causes", async () => {
    const cause = new Error("network details");
    const fetchImpl = (async () => {
      throw cause;
    }) as typeof fetch;

    const result = await fetchDrive(fetchImpl, "https://www.googleapis.com/drive/v3/files", {});

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.code).toBe("network_failed");
      expect(result.error.cause).toBe(cause);
    }
  });
});

describe("createDriveHttpResponseFailure", () => {
  it("retains status and a bounded body without making response details enumerable", async () => {
    const responseBody = '{"error":"SECRET-DRIVE-DIAGNOSTIC"}';
    const failure = await createDriveHttpResponseFailure(
      new Response(responseBody, { status: 503, statusText: "Service Unavailable" }),
      "write_failed",
    );

    expect(failure).toMatchObject({
      code: "write_failed",
      httpStatus: 503,
      cause: expect.any(HttpResponseError),
    });
    expect(failure.cause).toMatchObject({
      status: 503,
      statusText: "Service Unavailable",
      responseBody,
    });
    for (const property of ["status", "statusText", "responseBody"] as const) {
      expect(Object.prototype.propertyIsEnumerable.call(failure.cause, property)).toBe(false);
    }
    expect(JSON.stringify(failure)).not.toContain("SECRET-DRIVE-DIAGNOSTIC");
    expect(JSON.stringify(failure)).not.toContain("Service Unavailable");
  });

  it("marks an oversized diagnostic body without retaining its contents", async () => {
    const failure = await createDriveHttpResponseFailure(
      new Response("SECRET-OVERSIZED-DRIVE-DIAGNOSTIC", {
        status: 500,
        headers: { "Content-Length": String(16 * 1024 + 1) },
      }),
      "invalid_response",
    );

    expect(failure.cause.responseBody).toBe("too_large");
    expect(failure.cause.cause).toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain("SECRET-OVERSIZED-DRIVE-DIAGNOSTIC");
  });

  it("retains an operational body-read cause without retaining body contents", async () => {
    const readFailure = new TypeError("SECRET-DRIVE-READ-FAILURE");
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(readFailure);
        },
      }),
      { status: 502, statusText: "Bad Gateway" },
    );

    const failure = await createDriveHttpResponseFailure(response, "invalid_response");

    expect(failure.cause.responseBody).toBeNull();
    expect(failure.cause.cause).toEqual(expect.objectContaining({ cause: readFailure }));
    expect(JSON.stringify(failure)).not.toContain("SECRET-DRIVE-READ-FAILURE");
  });
});

describe("Drive file revisions", () => {
  it("parses non-empty Drive IDs and versions", () => {
    expect(parseDriveFileRevision({ id: "file-1", version: "7" })).toEqual({
      storageId: "file-1",
      revision: "7",
    });
    expect(parseDriveFileRevision({ id: "", version: "7" })).toBeNull();
    expect(parseDriveFileRevision({ id: "file-1" })).toBeNull();
  });

  it("compares both the Drive ID and revision", () => {
    const reference = { storageId: "file-1", revision: "7" };

    expect(sameDriveFileRevision(reference, reference)).toBe(true);
    expect(sameDriveFileRevision(reference, { ...reference, storageId: "file-2" })).toBe(false);
    expect(sameDriveFileRevision(reference, { ...reference, revision: "8" })).toBe(false);
  });

  it("compares stable Drive file identity independently of revision", () => {
    const reference = { storageId: "file-1", revision: "7" };

    expect(sameDriveFileIdentity(reference, { ...reference, revision: "8" })).toBe(true);
    expect(sameDriveFileIdentity(reference, { storageId: "file-2", revision: "7" })).toBe(false);
  });
});
