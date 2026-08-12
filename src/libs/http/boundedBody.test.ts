import { describe, expect, it } from "vitest";

import { readBoundedBytes, readBoundedText } from "./boundedBody";

describe("readBoundedBytes", () => {
  it("returns bounded response bytes", async () => {
    await expect(readBoundedBytes({ body: textStream(["pubky"]), headers: new Headers() }, 5))
      .resolves.toEqual(new TextEncoder().encode("pubky"));
  });
});

describe("readBoundedText", () => {
  it("reads a UTF-8 body within the configured limit", async () => {
    const result = await readBoundedText({
      body: textStream(["pubky", " passport"]),
      headers: new Headers(),
    }, 32);

    expect(result).toBe("pubky passport");
  });

  it("rejects oversized declared content before reading", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    const result = await readBoundedText({
      body,
      headers: new Headers({ "Content-Length": "33" }),
    }, 32);

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

  it("returns null for absent or failed bodies", async () => {
    await expect(readBoundedText({ body: null, headers: new Headers() }, 32)).resolves.toBeNull();

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("network failed"));
      },
    });

    await expect(readBoundedText({ body, headers: new Headers() }, 32)).resolves.toBeNull();
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
