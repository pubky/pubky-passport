import { Result, type Err, type Result as ResultType } from "better-result";
import { z } from "zod";

import type { PassportFileEnvelopeV1 } from "../../domain/passport-file/passportFile";

export type PassportFileField = keyof PassportFileEnvelopeV1;

export type PassportFileParseErrorCode =
  | "invalid_json"
  | "invalid_shape"
  | "unsupported_version"
  | "missing_field"
  | "invalid_field"
  | "unknown_field";

export type PassportFileParseError = {
  code: PassportFileParseErrorCode;
  field?: PassportFileField;
};

export type PassportFileParseResult = ResultType<PassportFileEnvelopeV1, PassportFileParseError>;

export type PassportFileUrlOptions = {
  allowLocalhostHttp?: boolean;
};

export type PassportFileOriginResult = ResultType<string, { code: "invalid_field"; field: "url" }>;

const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const passportFileEnvelopeSchema = z
  .object({
    v: z.number(),
    iv: z.string().regex(base64UrlPattern),
    ct: z.string().regex(base64UrlPattern),
    url: z.string(),
  })
  .strict();

export function parsePassportFileContents(input: unknown, options: PassportFileUrlOptions = {}): PassportFileParseResult {
  if (typeof input !== "string") {
    return error("invalid_json");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return error("invalid_json");
  }

  return parsePassportFileEnvelope(parsed, options);
}

export function parsePassportFileEnvelope(
  input: unknown,
  options: PassportFileUrlOptions = {},
): PassportFileParseResult {
  if (!isPlainObject(input)) {
    return error("invalid_shape");
  }

  const parsed = passportFileEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.code === "unrecognized_keys")) {
      return error("unknown_field");
    }

    const field = parsed.error.issues
      .map((issue) => issue.path[0])
      .find(
        (value): value is PassportFileField =>
          typeof value === "string" && Object.hasOwn(passportFileEnvelopeSchema.shape, value),
      );
    if (!field) {
      return error("invalid_shape");
    }

    return error(Object.hasOwn(input, field) ? "invalid_field" : "missing_field", field);
  }

  if (parsed.data.v !== 1) {
    return error("unsupported_version", "v");
  }

  const origin = normalizePassportFileOrigin(parsed.data.url, options);
  if (Result.isError(origin)) {
    return error(origin.error.code, origin.error.field);
  }

  return Result.ok({
      v: 1,
      iv: parsed.data.iv,
      ct: parsed.data.ct,
      url: origin.value,
  });
}

export function normalizePassportFileOrigin(
  value: string,
  options: PassportFileUrlOptions = {},
): PassportFileOriginResult {
  if (value.trim() !== value || value.length === 0) {
    return invalidUrl();
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalidUrl();
  }

  if (!isAllowedProtocol(url, options)) {
    return invalidUrl();
  }

  if (url.username || url.password || url.search || url.hash) {
    return invalidUrl();
  }

  if (url.pathname !== "/") {
    return invalidUrl();
  }

  return Result.ok(url.origin);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function isAllowedProtocol(url: URL, options: PassportFileUrlOptions): boolean {
  if (url.protocol === "https:") {
    return true;
  }

  return Boolean(options.allowLocalhostHttp && url.protocol === "http:" && isLocalhost(url.hostname));
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function invalidUrl(): Err<never, { code: "invalid_field"; field: "url" }> {
  return Result.err<never, { code: "invalid_field"; field: "url" }>({ code: "invalid_field", field: "url" });
}

function error(
  code: PassportFileParseErrorCode,
  field?: PassportFileField,
): Err<never, PassportFileParseError> {
  return Result.err<never, PassportFileParseError>(field ? { code, field } : { code });
}
