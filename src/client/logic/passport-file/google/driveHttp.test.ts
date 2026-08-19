import { describe, expect, it } from "vitest";

import {
  fetchDrive,
  parseDriveFileRevision,
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

    expect(result).toBe(response);
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

  it("maps fetch failures to null", async () => {
    const fetchImpl = (async () => {
      throw new Error("network details");
    }) as typeof fetch;

    await expect(fetchDrive(fetchImpl, "https://www.googleapis.com/drive/v3/files", {}))
      .resolves.toBeNull();
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
});
