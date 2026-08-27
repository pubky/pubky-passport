import "server-only";

import { Result, type Result as ResultType } from "better-result";
import { z } from "zod";

import { readBoundedText } from "../../../../libs/http/boundedBody";

const MAXIMUM_GOOGLE_ID_TOKEN_REQUEST_BYTES = 16 * 1024;
const REQUEST_SCHEMA = z.object({
  googleIdToken: z.string().trim().min(1),
  keyId: z.string().regex(/^[A-Za-z0-9._-]{1,32}$/).optional(),
}).strict();

export const GOOGLE_WRAPPING_KEY_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;

export async function parseGoogleIdTokenRequest(
  request: Request,
): Promise<ResultType<{ googleIdToken: string; keyId?: string | undefined }, "invalid_request">> {
  if (!isJsonContentType(request.headers.get("Content-Type"))) {
    return Result.err("invalid_request");
  }

  const text = await readBoundedText(request, MAXIMUM_GOOGLE_ID_TOKEN_REQUEST_BYTES);
  if (text === null || text === "too_large") {
    return Result.err("invalid_request");
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Result.err("invalid_request");
  }

  const parsed = REQUEST_SCHEMA.safeParse(body);
  return parsed.success ? Result.ok(parsed.data) : Result.err("invalid_request");
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
