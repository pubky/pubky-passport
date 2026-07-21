import { Result, type Result as ResultType } from "better-result";

import { readBoundedText } from "./boundedBody";

export async function parseBoundedJsonStringField(
  request: Request,
  fieldName: string,
  maximumBytes: number,
): Promise<ResultType<string, "invalid_request">> {
  if (!isJsonContentType(request.headers.get("Content-Type"))) {
    return Result.err("invalid_request");
  }

  const text = await readBoundedText(request, maximumBytes);
  if (text === null || text === "too_large") {
    return Result.err("invalid_request");
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Result.err("invalid_request");
  }

  if (!isRecord(body)) {
    return Result.err("invalid_request");
  }

  const keys = Object.keys(body);
  const fieldValue = body[fieldName];
  if (keys.length !== 1 || keys[0] !== fieldName || typeof fieldValue !== "string" || fieldValue.trim().length === 0) {
    return Result.err("invalid_request");
  }

  return Result.ok(fieldValue);
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
