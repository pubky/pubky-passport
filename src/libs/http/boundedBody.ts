export type BoundedTextBody = {
  body: ReadableStream<Uint8Array> | null;
  headers: Headers;
};

export async function readBoundedText(
  source: BoundedTextBody,
  maximumBytes: number,
): Promise<string | "too_large" | null> {
  if (contentLengthExceeds(source.headers.get("Content-Length"), maximumBytes)) {
    try {
      await source.body?.cancel();
    } catch {
      // The oversized response is already rejected; cancellation is best effort.
    }
    return "too_large";
  }

  const reader = source.body?.getReader();
  if (!reader) {
    return null;
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
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
        return "too_large";
      }

      chunks.push(value);
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function contentLengthExceeds(contentLength: string | null, maximumBytes: number): boolean {
  return contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > maximumBytes;
}
