import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import { LOGGER } from "../logger/logger";
import { readBoundedBytes, readBoundedText } from "./boundedBody";

afterEach(() => vi.restoreAllMocks());

describe("readBoundedBytes", () => {
  it("returns bounded response bytes", async () => {
    const result = await readBoundedBytes(
      { body: textStream(["pubky"]), headers: new Headers() },
      5,
    );
    expect(Result.isOk(result) && result.value).toEqual(new TextEncoder().encode("pubky"));
  });
});

describe("readBoundedText", () => {
  it("reads a UTF-8 body within the configured limit", async () => {
    const result = await readBoundedText(
      {
        body: textStream(["pubky", " passport"]),
        headers: new Headers(),
      },
      32,
    );

    expect(Result.isOk(result) && result.value).toBe("pubky passport");
  });

  it("rejects oversized declared content before reading", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    const result = await readBoundedText(
      {
        body,
        headers: new Headers({ "Content-Length": "33" }),
      },
      32,
    );

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toMatchObject({ code: "body_too_large" });
      expect(result.error.cause).toBeInstanceOf(Error);
    }
    expect(cancelled).toBe(true);
  });

  it("rejects a streaming body that exceeds the configured limit", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("pubky"));
        controller.enqueue(new TextEncoder().encode(" passport"));
      },
      cancel() {
        cancelled = true;
      },
    });

    const result = await readBoundedText({ body, headers: new Headers() }, 8);

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toMatchObject({ code: "body_too_large" });
      expect(result.error.cause).toBeInstanceOf(Error);
    }
    expect(cancelled).toBe(true);
  });

  it("returns an error for an absent body", async () => {
    const result = await readBoundedText({ body: null, headers: new Headers() }, 32);
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toMatchObject({ code: "body_unavailable" });
      expect(result.error.cause).toBeInstanceOf(Error);
    }
  });

  it("preserves body read failures without logging their details", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new TypeError("SECRET-BODY-READ-FAILURE");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(cause);
      },
    });

    const result = await readBoundedText(
      {
        body,
        headers: new Headers({ "X-Response-Value": "SECRET-RESPONSE-VALUE" }),
      },
      32,
    );
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toMatchObject({ code: "body_unavailable", cause: expect.any(Error) });
      expect(result.error.cause.cause).toBe(cause);
    }
    expect(warning).not.toHaveBeenCalled();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-BODY-READ-FAILURE");
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-RESPONSE-VALUE");
  });

  it("contains header access failures", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const headers = {
      get() {
        throw new TypeError("SECRET-HEADER-CANARY");
      },
    } as unknown as Headers;

    const result = await readBoundedText({ body: null, headers }, 32);
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toMatchObject({ code: "body_unavailable" });
      expect(result.error.cause.cause).toBeInstanceOf(TypeError);
    }
    expect(warning).not.toHaveBeenCalled();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-HEADER-CANARY");
  });

  it("contains reader release failures", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    vi.spyOn(ReadableStreamDefaultReader.prototype, "releaseLock").mockImplementationOnce(() => {
      throw new TypeError("SECRET-RELEASE-CANARY");
    });

    const result = await readBoundedText(
      { body: textStream(["pubky"]), headers: new Headers() },
      32,
    );
    expect(Result.isOk(result) && result.value).toBe("pubky");
    expect(warning).toHaveBeenCalledWith("http.body_read.failed", {
      operation: "release",
      code: "body_unavailable",
      diagnosticId: expect.any(String),
      errorName: "TypeError",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-RELEASE-CANARY");
  });
});

function textStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}
