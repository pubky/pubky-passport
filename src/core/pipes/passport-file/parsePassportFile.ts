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

export type PassportFileParseResult =
  | { ok: true; envelope: PassportFileEnvelopeV1 }
  | { ok: false; error: PassportFileParseError };

export type PassportFileUrlOptions = {
  allowLocalhostHttp?: boolean;
};

export type PassportFileOriginResult =
  | { ok: true; origin: string }
  | { ok: false; error: { code: "invalid_field"; field: "url" } };

const envelopeFieldMap = {
  v: true,
  iv: true,
  ct: true,
  url: true,
} satisfies Record<PassportFileField, true>;

const envelopeFields = Object.keys(envelopeFieldMap) as PassportFileField[];
const envelopeFieldSet = new Set<PassportFileField>(envelopeFields);
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

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

  for (const field of envelopeFields) {
    if (!(field in input)) {
      return error("missing_field", field);
    }
  }

  for (const field of Object.keys(input)) {
    if (!isPassportFileField(field)) {
      return error("unknown_field");
    }
  }

  if (input.v !== 1) {
    return typeof input.v === "number" ? error("unsupported_version", "v") : error("invalid_field", "v");
  }

  if (!isBase64UrlLike(input.iv)) {
    return error("invalid_field", "iv");
  }

  if (!isBase64UrlLike(input.ct)) {
    return error("invalid_field", "ct");
  }

  if (typeof input.url !== "string") {
    return error("invalid_field", "url");
  }

  const origin = normalizePassportFileOrigin(input.url, options);
  if (!origin.ok) {
    return origin;
  }

  return {
    ok: true,
    envelope: {
      v: 1,
      iv: input.iv,
      ct: input.ct,
      url: origin.origin,
    },
  };
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

  return { ok: true, origin: url.origin };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function isBase64UrlLike(value: unknown): value is string {
  return typeof value === "string" && base64UrlPattern.test(value);
}

function isPassportFileField(value: string): value is PassportFileField {
  return envelopeFieldSet.has(value as PassportFileField);
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

function invalidUrl(): { ok: false; error: { code: "invalid_field"; field: "url" } } {
  return { ok: false, error: { code: "invalid_field", field: "url" } };
}

function error(code: PassportFileParseErrorCode, field?: PassportFileField): { ok: false; error: PassportFileParseError } {
  return { ok: false, error: field ? { code, field } : { code } };
}
