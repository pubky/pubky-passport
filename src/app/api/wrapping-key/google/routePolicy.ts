import "server-only";

import { Result, type Result as ResultType } from "better-result";

import { readBoundedText } from "../../../../libs/http/boundedBody";

const MAXIMUM_CREDENTIAL_REQUEST_BYTES = 16 * 1024;

export const GOOGLE_WRAPPING_KEY_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;

export async function parseGoogleWrappingKeyRequest(
  request: Request,
): Promise<ResultType<string, "invalid_request">> {
  if (!isJsonContentType(request.headers.get("Content-Type"))) {
    return Result.err("invalid_request");
  }

  const text = await readBoundedText(request, MAXIMUM_CREDENTIAL_REQUEST_BYTES);
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
  const googleIdToken = body.googleIdToken;
  if (
    keys.length !== 1
    || keys[0] !== "googleIdToken"
    || typeof googleIdToken !== "string"
    || googleIdToken.trim().length === 0
  ) {
    return Result.err("invalid_request");
  }

  return Result.ok(googleIdToken);
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
