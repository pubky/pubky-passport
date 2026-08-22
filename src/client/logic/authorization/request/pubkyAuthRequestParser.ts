import "client-only";

import { Result, type Err, type Result as ResultType } from "better-result";

import {
  parsePubkyAuthCapabilities,
  type PubkyAuthCapability,
  type PubkyAuthCapabilitiesParseError,
} from "./pubkyAuthCapabilities";
import {
  validatePubkyAuthUrls,
  type ValidatedPubkyAuthCallbacks,
  type PubkyAuthUrlValidationError,
} from "./pubkyAuthUrls";
import { PUBKY_AUTH_REQUEST_LIMITS } from "./pubkyAuthRequestLimits";

export type PubkyAuthenticationMethod = "cookie" | "grant";

const PUBKY_AUTH_REQUEST_PARAMETERS = {
  relay: "relay",
  secret: "secret",
  capabilities: "caps",
  source: "x-source",
  success: "x-success",
  error: "x-error",
  cancel: "x-cancel",
  legacySuccess: "callback",
  clientId: "cid",
  clientPublicKey: "cpk",
} as const;

const COMMON_PARAMETERS = new Set<string>([
  PUBKY_AUTH_REQUEST_PARAMETERS.relay,
  PUBKY_AUTH_REQUEST_PARAMETERS.secret,
  PUBKY_AUTH_REQUEST_PARAMETERS.capabilities,
  PUBKY_AUTH_REQUEST_PARAMETERS.source,
  PUBKY_AUTH_REQUEST_PARAMETERS.success,
  PUBKY_AUTH_REQUEST_PARAMETERS.error,
  PUBKY_AUTH_REQUEST_PARAMETERS.cancel,
  PUBKY_AUTH_REQUEST_PARAMETERS.legacySuccess,
]);
const GRANT_PARAMETERS = new Set<string>([
  ...COMMON_PARAMETERS,
  PUBKY_AUTH_REQUEST_PARAMETERS.clientId,
  PUBKY_AUTH_REQUEST_PARAMETERS.clientPublicKey,
]);

export type PubkyAuthParseErrorCode =
  | "missing_d"
  | "request_too_large"
  | "invalid_encoding"
  | "invalid_url"
  | "unsupported_scheme"
  | "invalid_auth_request_path"
  | "missing_secret"
  | "invalid_secret"
  | "missing_client_id"
  | "invalid_client_id"
  | "missing_client_public_key"
  | "invalid_client_public_key"
  | "missing_capabilities"
  | "invalid_capability"
  | "duplicate_parameter"
  | "unsupported_parameter"
  | PubkyAuthUrlValidationError["code"];

export type PubkyAuthParseError = {
  code: PubkyAuthParseErrorCode;
};

export type ParsedPubkyAuthRequest = {
  authenticationMethod: PubkyAuthenticationMethod;
  capabilities: PubkyAuthCapability[];
  callbacks: Readonly<ValidatedPubkyAuthCallbacks>;
  sensitivePubkyAuthUrl: string;
};

export type PubkyAuthParseResult = ResultType<ParsedPubkyAuthRequest, PubkyAuthParseError>;

type ParseValueResult<Value> = ResultType<Value, PubkyAuthParseError>;

const PUBKY_AUTH_PROTOCOL = "pubkyauth:";

/**
 * Parses and bounds one encoded Pubky Auth URL without issuing signing
 * authority. The returned URL remains sensitive and must not enter UI state.
 * Callers must either issue it immediately or use the validation-only wrapper.
 */
export function parseEncodedPubkyAuthRequest(
  encodedRequest: unknown,
): PubkyAuthParseResult {
  if (typeof encodedRequest !== "string" || encodedRequest.length === 0) {
    return error("missing_d");
  }

  if (encodedRequest.length > PUBKY_AUTH_REQUEST_LIMITS.maximumEncodedDCodeUnits) {
    return error("request_too_large");
  }

  const decoded = decodeDParam(encodedRequest);
  if (Result.isError(decoded)) {
    return Result.err(decoded.error);
  }

  if (decoded.value.length > PUBKY_AUTH_REQUEST_LIMITS.maximumDecodedAuthUrlCodeUnits) {
    return error("request_too_large");
  }

  if (decoded.value === encodedRequest) {
    return error("invalid_encoding");
  }

  const authUrl = parseUrl(decoded.value);
  if (Result.isError(authUrl)) {
    return Result.err(authUrl.error);
  }

  if (authUrl.value.protocol !== PUBKY_AUTH_PROTOCOL) {
    return error("unsupported_scheme");
  }

  const authenticationMethod = parseAuthenticationMethod(authUrl.value);
  if (Result.isError(authenticationMethod)) {
    return Result.err(authenticationMethod.error);
  }

  const secret = authUrl.value.searchParams.get(PUBKY_AUTH_REQUEST_PARAMETERS.secret);
  if (!secret) {
    return error("missing_secret");
  }

  if (
    secret.length > PUBKY_AUTH_REQUEST_LIMITS.maximumSecretCodeUnits ||
    !isCanonicalAuthSecret(secret)
  ) {
    return error("invalid_secret");
  }

  const parameters = validatePubkyAuthRequestParameters(
    authUrl.value.searchParams,
    authenticationMethod.value,
  );
  if (Result.isError(parameters)) {
    return Result.err(parameters.error);
  }

  const grantParameters = validateGrantParameters(
    authUrl.value,
    authenticationMethod.value,
  );
  if (Result.isError(grantParameters)) {
    return Result.err(grantParameters.error);
  }

  const urls = validatePubkyAuthUrls(authUrl.value, PUBKY_AUTH_REQUEST_PARAMETERS);
  if (Result.isError(urls)) {
    return Result.err(urls.error);
  }

  const requestedCapabilities = authUrl.value.searchParams.get(PUBKY_AUTH_REQUEST_PARAMETERS.capabilities);
  if (requestedCapabilities === null) {
    return error("missing_capabilities");
  }

  const capabilities = parsePubkyAuthCapabilities(requestedCapabilities);
  if (Result.isError(capabilities)) {
    return error(mapCapabilitiesError(capabilities.error));
  }

  const normalizedCapabilities = requestedCapabilities.normalize("NFC");
  const sensitivePubkyAuthUrl = normalizedCapabilities === requestedCapabilities
    ? decoded.value
    : replaceCapabilities(authUrl.value, normalizedCapabilities);

  return Result.ok({
    authenticationMethod: authenticationMethod.value,
    capabilities: capabilities.value,
    callbacks: Object.freeze({ ...urls.value }),
    sensitivePubkyAuthUrl,
  });
}

function replaceCapabilities(authUrl: URL, capabilities: string): string {
  authUrl.searchParams.set(PUBKY_AUTH_REQUEST_PARAMETERS.capabilities, capabilities);
  return authUrl.toString();
}

function decodeDParam(d: string): ParseValueResult<string> {
  try {
    return Result.ok(decodeURIComponent(d));
  } catch {
    return error("invalid_encoding");
  }
}

function parseUrl(value: string): ParseValueResult<URL> {
  try {
    return Result.ok(new URL(value));
  } catch {
    return error("invalid_url");
  }
}

function parseAuthenticationMethod(url: URL): ParseValueResult<PubkyAuthenticationMethod> {
  if (url.hostname === "signin" && url.pathname === "") {
    return Result.ok("cookie");
  }

  if (url.hostname === "signin_grant" && url.pathname === "") {
    return Result.ok("grant");
  }

  if (url.hostname === "" && url.pathname === "/") {
    return Result.ok("cookie");
  }

  return error("invalid_auth_request_path");
}

function validatePubkyAuthRequestParameters(
  searchParams: URLSearchParams,
  authenticationMethod: PubkyAuthenticationMethod,
): ParseValueResult<void> {
  const seen = new Set<string>();
  const supportedParameters = authenticationMethod === "grant"
    ? GRANT_PARAMETERS
    : COMMON_PARAMETERS;

  for (const [name] of searchParams) {
    if (!supportedParameters.has(name)) {
      return error("unsupported_parameter");
    }

    if (seen.has(name)) {
      return error("duplicate_parameter");
    }

    seen.add(name);
  }

  return Result.ok();
}

function validateGrantParameters(
  url: URL,
  authenticationMethod: PubkyAuthenticationMethod,
): ParseValueResult<void> {
  if (authenticationMethod === "cookie") return Result.ok();

  const clientId = url.searchParams.get(PUBKY_AUTH_REQUEST_PARAMETERS.clientId);
  if (clientId === null || clientId.length === 0) {
    return error("missing_client_id");
  }
  if (utf8Length(clientId) > PUBKY_AUTH_REQUEST_LIMITS.maximumClientIdUtf8Bytes) {
    return error("invalid_client_id");
  }

  const clientPublicKey = url.searchParams.get(PUBKY_AUTH_REQUEST_PARAMETERS.clientPublicKey);
  if (clientPublicKey === null || clientPublicKey.length === 0) {
    return error("missing_client_public_key");
  }
  if (!isCanonicalPublicKey(clientPublicKey)) {
    return error("invalid_client_public_key");
  }

  return Result.ok();
}

const BASE64_URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const Z_BASE_32_ALPHABET = "ybndrfg8ejkmcpqxot1uwisza345h769";

function isCanonicalAuthSecret(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return false;
  const lastCharacter = value.at(-1);
  return lastCharacter !== undefined && BASE64_URL_ALPHABET.indexOf(lastCharacter) % 4 === 0;
}

function isCanonicalPublicKey(value: string): boolean {
  if (value.length !== 52) return false;
  for (const character of value) {
    if (!Z_BASE_32_ALPHABET.includes(character)) return false;
  }
  return value.endsWith("y") || value.endsWith("o");
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function mapCapabilitiesError(
  capabilitiesError: PubkyAuthCapabilitiesParseError,
): "missing_capabilities" | "invalid_capability" {
  return capabilitiesError.code === "missing_capabilities"
    ? "missing_capabilities"
    : "invalid_capability";
}

function error(
  code: PubkyAuthParseErrorCode,
): Err<never, PubkyAuthParseError> {
  return Result.err<never, PubkyAuthParseError>({ code });
}
