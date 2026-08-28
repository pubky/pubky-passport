import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../logger/logger";
import { readBoundedBytes, readBoundedText } from "./boundedBody";

afterEach(() => vi.restoreAllMocks());

describe("readBoundedBytes", () => {
  it("returns bounded response bytes", async () => {
    await expect(
      readBoundedBytes({ body: textStream(["pubky"]), headers: new Headers() }, 5),
    ).resolves.toEqual(new TextEncoder().encode("pubky"));
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

    expect(result).toBe("pubky passport");
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

    expect(result).toBe("too_large");
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

    expect(result).toBe("too_large");
    expect(cancelled).toBe(true);
  });

  it("returns null for an absent body", async () => {
    await expect(readBoundedText({ body: null, headers: new Headers() }, 32)).resolves.toBeNull();
  });

  it("safely logs body read failures", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new TypeError("SECRET-BODY-READ-FAILURE");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(cause);
      },
    });

    await expect(
      readBoundedText(
        {
          body,
          headers: new Headers({ "X-Response-Value": "SECRET-RESPONSE-VALUE" }),
        },
        32,
      ),
    ).resolves.toBeNull();
    expect(warning).toHaveBeenCalledWith("http.body_read.failed", {
      operation: "read",
      code: "body_unavailable",
    });
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

    await expect(readBoundedText({ body: null, headers }, 32)).resolves.toBeNull();
    expect(warning).toHaveBeenCalledWith("http.body_read.failed", {
      operation: "read",
      code: "body_unavailable",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-HEADER-CANARY");
  });

  it("contains reader release failures", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    vi.spyOn(ReadableStreamDefaultReader.prototype, "releaseLock").mockImplementationOnce(() => {
      throw new TypeError("SECRET-RELEASE-CANARY");
    });

    await expect(
      readBoundedText({ body: textStream(["pubky"]), headers: new Headers() }, 32),
    ).resolves.toBe("pubky");
    expect(warning).toHaveBeenCalledWith("http.body_read.failed", {
      operation: "release",
      code: "body_unavailable",
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
