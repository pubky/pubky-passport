import "server-only";

import { Result, type Result as ResultType } from "better-result";

import { readBoundedText } from "../../../../libs/http/boundedBody";

const MAXIMUM_REQUEST_BYTES = 8 * 1024;

export async function parseGoogleAuthorizationCode(request: Request): Promise<ResultType<string, "invalid_request">> {
  if (request.headers.get("Origin") !== new URL(request.url).origin) return Result.err("invalid_request");
  if (request.headers.get("X-Requested-With") !== "XmlHttpRequest") return Result.err("invalid_request");
  if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return Result.err("invalid_request");
  const text = await readBoundedText(request, MAXIMUM_REQUEST_BYTES);
  if (text === null || text === "too_large") return Result.err("invalid_request");
  let body: unknown;
  try { body = JSON.parse(text); } catch { return Result.err("invalid_request"); }
  if (!isRecord(body) || Object.keys(body).length !== 1 || typeof body.code !== "string" || body.code.trim().length === 0) return Result.err("invalid_request");
  return Result.ok(body.code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
