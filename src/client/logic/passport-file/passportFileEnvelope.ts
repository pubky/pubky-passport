import "client-only";

import { Result, type Result as ResultType } from "better-result";
import { z } from "zod";

/** Strict encrypted envelope persisted as Passport file format version 1. */
export type PassportFileEnvelopeV1 = {
  /** Numeric storage format version. */
  v: 1;
  /** Unpadded base64url AES-GCM initialization vector. */
  iv: string;
  /** Unpadded base64url ciphertext including the AES-GCM authentication tag. */
  ct: string;
  /** Normalized Passport origin authenticated during encryption. */
  url: string;
};

/** Field names accepted by the strict v1 envelope schema. */
export type PassportFileField = keyof PassportFileEnvelopeV1;

/** Safe parser failure codes that never include envelope contents. */
export type PassportFileParseErrorCode =
  | "invalid_json"
  | "invalid_shape"
  | "unsupported_version"
  | "missing_field"
  | "invalid_field"
  | "unknown_field";

/** Safe envelope parse failure with optional field attribution. */
export type PassportFileParseError = {
  code: PassportFileParseErrorCode;
  field?: PassportFileField;
};

type PassportFileParseResult = ResultType<PassportFileEnvelopeV1, PassportFileParseError>;

type PassportFileOriginResult = ResultType<string, { code: "invalid_field"; field: "url" }>;

const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const PASSPORT_FILE_ENVELOPE_SCHEMA = z
  .object({
    v: z.number(),
    iv: z.string().regex(BASE64_URL_PATTERN),
    ct: z.string().regex(BASE64_URL_PATTERN),
    url: z.string(),
  })
  .strict();

/**
 * Parses serialized Passport file contents into a validated v1 envelope.
 *
 * JSON syntax, object shape, accepted fields, version, and origin are validated.
 * The IV and ciphertext are not decoded, decrypted, or checked for cryptographic
 * byte lengths by this parser.
 */
export function parsePassportFileContents(input: unknown): PassportFileParseResult {
  if (typeof input !== "string") {
    return Result.err<never, PassportFileParseError>({ code: "invalid_json" });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return Result.err<never, PassportFileParseError>({ code: "invalid_json" });
  }

  return parsePassportFileEnvelope(parsed);
}

/**
 * Validates an unknown value as an exact v1 envelope and normalizes its origin.
 * Unknown fields are rejected to reduce the risk of accidentally accepting
 * plaintext or unrelated metadata as an encrypted Passport file.
 */
export function parsePassportFileEnvelope(input: unknown): PassportFileParseResult {
  if (!isPlainObject(input)) {
    return Result.err<never, PassportFileParseError>({ code: "invalid_shape" });
  }

  if (typeof input.v === "number" && input.v !== 1) {
    return Result.err<never, PassportFileParseError>({ code: "unsupported_version", field: "v" });
  }

  const parsed = PASSPORT_FILE_ENVELOPE_SCHEMA.safeParse(input);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.code === "unrecognized_keys")) {
      return Result.err<never, PassportFileParseError>({ code: "unknown_field" });
    }

    const field = parsed.error.issues
      .map((issue) => issue.path[0])
      .find(
        (value): value is PassportFileField =>
          typeof value === "string" && Object.hasOwn(PASSPORT_FILE_ENVELOPE_SCHEMA.shape, value),
      );
    if (!field) {
      return Result.err<never, PassportFileParseError>({ code: "invalid_shape" });
    }

    return Result.err<never, PassportFileParseError>({
      code: Object.hasOwn(input, field) ? "invalid_field" : "missing_field",
      field,
    });
  }

  const origin = normalizePassportFileOrigin(parsed.data.url);
  if (Result.isError(origin)) {
    return Result.err<never, PassportFileParseError>({
      code: origin.error.code,
      field: origin.error.field,
    });
  }

  return Result.ok({
    v: 1,
    iv: parsed.data.iv,
    ct: parsed.data.ct,
    url: origin.value,
  });
}

/**
 * Serializes only the validated v1 envelope fields in their canonical order.
 * Returns `null` when the input is not a valid envelope.
 */
export function serializePassportFileEnvelope(input: unknown): string | null {
  const parsed = parsePassportFileEnvelope(input);
  if (Result.isError(parsed)) return null;
  return JSON.stringify({
    v: parsed.value.v,
    iv: parsed.value.iv,
    ct: parsed.value.ct,
    url: parsed.value.url,
  });
}

/**
 * Validates a Passport file origin and returns its normalized origin string.
 * Credentials, query parameters, fragments, and non-root paths are rejected.
 */
export function normalizePassportFileOrigin(value: string): PassportFileOriginResult {
  const url = parseUrl(value);
  if (!url || !isAllowedPassportFileOrigin(url)) {
    return Result.err<never, { code: "invalid_field"; field: "url" }>({
      code: "invalid_field",
      field: "url",
    });
  }

  return Result.ok(url.origin);
}

function isAllowedPassportFileOrigin(url: URL): boolean {
  return url.protocol === "https:" && hasNoCredentialsOrUrlParts(url) && url.pathname === "/";
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

function hasNoCredentialsOrUrlParts(url: URL): boolean {
  return !url.username && !url.password && !url.search && !url.hash;
}
