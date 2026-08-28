import "client-only";

import { Result, type Result as ResultType } from "better-result";
import { z } from "zod";

import { decodeBase64Url } from "../../../libs/encoding/base64Url";
import { passportKeyIdSchema } from "../../../libs/passportPolicy";
import { PUBKY_SECRET_KEY_BYTES } from "../pubky/pubkyIdentityKey";

export type PassportFileEnvelope = {
  /** Numeric storage format version. */
  v: 1;
  /** Public identifier for the server secret used to derive the wrapping key. */
  keyId: string;
  /** Unpadded base64url AES-GCM initialization vector. */
  iv: string;
  /** Unpadded base64url ciphertext including the AES-GCM authentication tag. */
  ct: string;
  /** Normalized Passport origin authenticated during encryption. */
  url: string;
};

/** Only distinctions that change production behavior are exposed. */
export type PassportFileParseError = {
  code: "invalid_json" | "invalid_file" | "unsupported_version";
};

type PassportFileParseResult = ResultType<PassportFileEnvelope, PassportFileParseError>;

type PassportFileOriginResult = ResultType<string, { code: "invalid_field"; field: "url" }>;

const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const AES_GCM_CIPHERTEXT_BYTES = PUBKY_SECRET_KEY_BYTES + AES_GCM_TAG_BYTES;
const CRYPTO_FIELDS = {
  iv: z.string().refine((value) => isFixedLengthBase64Url(value, AES_GCM_IV_BYTES)),
  ct: z.string().refine((value) => isFixedLengthBase64Url(value, AES_GCM_CIPHERTEXT_BYTES)),
  url: z.string(),
};
const PASSPORT_FILE_ENVELOPE_SCHEMA = z
  .object({
    v: z.literal(1),
    keyId: passportKeyIdSchema,
    ...CRYPTO_FIELDS,
  })
  .strict();

/**
 * Parses serialized Passport file contents into a validated envelope.
 *
 * JSON syntax, object shape, accepted fields, version, cryptographic field
 * encoding and lengths, and origin are validated. Authentication is left to
 * decryption.
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
    return Result.err<never, PassportFileParseError>({ code: "invalid_file" });
  }

  if (typeof input.v === "number" && input.v !== 1) {
    return Result.err<never, PassportFileParseError>({ code: "unsupported_version" });
  }

  const parsed = PASSPORT_FILE_ENVELOPE_SCHEMA.safeParse(input);
  if (!parsed.success) {
    return Result.err<never, PassportFileParseError>({ code: "invalid_file" });
  }

  const origin = normalizePassportFileOrigin(parsed.data.url);
  if (Result.isError(origin)) {
    return Result.err<never, PassportFileParseError>({ code: "invalid_file" });
  }

  return Result.ok({
    ...parsed.data,
    iv: parsed.data.iv,
    ct: parsed.data.ct,
    url: origin.value,
  });
}

/**
 * Serializes only validated envelope fields in their canonical order.
 * Returns `null` when the input is not a valid envelope.
 */
export function serializePassportFileEnvelope(input: unknown): string | null {
  const parsed = parsePassportFileEnvelope(input);
  if (Result.isError(parsed)) return null;
  return JSON.stringify({
    v: 1,
    keyId: parsed.value.keyId,
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
  return (
    Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  );
}

function isFixedLengthBase64Url(value: string, expectedByteLength: number): boolean {
  if (value.length !== Math.ceil((expectedByteLength * 4) / 3)) return false;
  return decodeBase64Url(value)?.byteLength === expectedByteLength;
}

function hasNoCredentialsOrUrlParts(url: URL): boolean {
  return !url.username && !url.password && !url.search && !url.hash;
}
