import { Result, type Err, type Result as ResultType } from "better-result";
import { z } from "zod";

import type { PassportFileEnvelopeV1 } from "./passportFile";

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

export type PassportFileOriginResult = ResultType<string, { code: "invalid_field"; field: "url" }>;

const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const PASSPORT_FILE_ENVELOPE_SCHEMA = z
  .object({
    v: z.number(),
    iv: z.string().regex(BASE64_URL_PATTERN),
    ct: z.string().regex(BASE64_URL_PATTERN),
    url: z.string(),
  })
  .strict();

export function parsePassportFileContents(input: unknown): PassportFileParseResult {
  if (typeof input !== "string") {
    return error("invalid_json");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return error("invalid_json");
  }

  return parsePassportFileEnvelope(parsed);
}

export function parsePassportFileEnvelope(input: unknown): PassportFileParseResult {
  if (!isPlainObject(input)) {
    return error("invalid_shape");
  }

  const parsed = PASSPORT_FILE_ENVELOPE_SCHEMA.safeParse(input);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.code === "unrecognized_keys")) {
      return error("unknown_field");
    }

    const field = parsed.error.issues
      .map((issue) => issue.path[0])
      .find(
        (value): value is PassportFileField =>
          typeof value === "string" && Object.hasOwn(PASSPORT_FILE_ENVELOPE_SCHEMA.shape, value),
      );
    if (!field) {
      return error("invalid_shape");
    }

    return error(Object.hasOwn(input, field) ? "invalid_field" : "missing_field", field);
  }

  if (parsed.data.v !== 1) {
    return error("unsupported_version", "v");
  }

  const origin = normalizePassportFileOrigin(parsed.data.url);
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

export function normalizePassportFileOrigin(value: string): PassportFileOriginResult {
  const url = parseUrl(value);
  if (!url || !isAllowedPassportFileOrigin(url)) {
    return invalidUrl();
  }

  return Result.ok(url.origin);
}

function parseUrl(value: string): URL | null {
  if (value.length === 0 || value.trim() !== value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function isAllowedPassportFileOrigin(url: URL): boolean {
  return url.protocol === "https:" && hasNoCredentialsOrUrlParts(url) && url.pathname === "/";
}

function hasNoCredentialsOrUrlParts(url: URL): boolean {
  return !url.username && !url.password && !url.search && !url.hash;
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
