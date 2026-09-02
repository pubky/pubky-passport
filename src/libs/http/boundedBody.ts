import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "../logger/logger";

export type BoundedBody = {
  body: ReadableStream<Uint8Array> | null;
  headers: Headers;
};

export type BoundedBodyReadFailure = {
  code: "body_too_large" | "body_unavailable";
  cause: Error;
};

/** Reads bounded bytes and preserves operational read failures for the caller. */
export async function readBoundedBytes(
  source: BoundedBody,
  maximumBytes: number,
): Promise<ResultType<Uint8Array, BoundedBodyReadFailure>> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (contentLengthExceeds(source.headers.get("Content-Length"), maximumBytes)) {
      try {
        await source.body?.cancel();
      } catch {
        // The oversized response is already rejected; cancellation is best effort.
      }
      return Result.err({
        code: "body_too_large",
        cause: new Error(`Response body exceeds the ${maximumBytes}-byte limit.`),
      });
    }

    reader = source.body?.getReader();
    if (!reader) {
      return Result.err({
        code: "body_unavailable",
        cause: new Error("Response body is unavailable."),
      });
    }

    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The oversized response is already rejected; cancellation is best effort.
        }
        return Result.err({
          code: "body_too_large",
          cause: new Error(`Response body exceeds the ${maximumBytes}-byte limit.`),
        });
      }

      chunks.push(value);
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return Result.ok(bytes);
  } catch (e) {
    return Result.err({
      code: "body_unavailable",
      cause: new Error("Failed to read response body.", { cause: e }),
    });
  } finally {
    try {
      reader?.releaseLock();
    } catch (e) {
      LOGGER.warn("http.body_read.failed", {
        operation: "release",
        code: "body_unavailable",
        ...safeErrorLogFields(e),
      });
    }
  }
}

export async function readBoundedText(
  source: BoundedBody,
  maximumBytes: number,
): Promise<ResultType<string, BoundedBodyReadFailure>> {
  const bytes = await readBoundedBytes(source, maximumBytes);
  return Result.isError(bytes)
    ? Result.err(bytes.error)
    : Result.ok(new TextDecoder().decode(bytes.value));
}

function contentLengthExceeds(contentLength: string | null, maximumBytes: number): boolean {
  return (
    contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > maximumBytes
  );
}
