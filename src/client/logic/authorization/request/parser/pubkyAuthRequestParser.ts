import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { parsePubkyAuthCapabilities, type PubkyAuthCapability } from "./pubkyAuthCapabilities";
import {
  getRawQueryValue,
  validatePubkyAuthUrls,
  type ValidatedPubkyAuthCallbacks,
  type PubkyAuthUrlValidationError,
} from "./pubkyAuthUrls";
import {
  isCanonicalPubkyAuthSecret,
  isCanonicalPubkyPublicKey,
  utf8Length,
} from "@/client/logic/pubky/pubkyProtocol";

export type PubkyAuthenticationMethod = "cookie" | "grant";

/** Bounds enforced directly by the encoded authorization request parser. */
export const PUBKY_AUTH_REQUEST_LIMITS = {
  maximumEncodedDCodeUnits: 24_576,
  maximumDecodedAuthUrlCodeUnits: 8_192,
  maximumSecretCodeUnits: 1_024,
  maximumSourceCodeUnits: 128,
  maximumClientIdUtf8Bytes: 253,
} as const;

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

type PubkyAuthParseErrorCode =
  | "missing_d"
  | "request_too_large"
  | "invalid_encoding"
  | "invalid_url"
  | "unsupported_scheme"
  | "invalid_auth_request_path"
  | "missing_secret"
  | "invalid_secret"
  | "invalid_source"
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
  source?: string;
  sensitivePubkyAuthUrl: string;
};

export type PubkyAuthParseResult = ResultType<ParsedPubkyAuthRequest, PubkyAuthParseError>;
export type ValidatePubkyAuthRequestResult = ResultType<void, PubkyAuthParseError>;

type ParseValueResult<Value> = ResultType<Value, PubkyAuthParseError>;

const PUBKY_AUTH_PROTOCOL = "pubkyauth:";
const UNSAFE_SOURCE_CHARACTERS =
  /[\p{Cc}\p{Zl}\p{Zp}\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;

/**
 * Parses and bounds one encoded Pubky Auth URL without issuing signing
 * authority. The returned URL remains sensitive and must not enter UI state.
 * Callers must either construct the validated request wrapper immediately or
 * use the validation-only function.
 */
export function parseEncodedPubkyAuthRequest(encodedRequest: unknown): PubkyAuthParseResult {
  if (typeof encodedRequest !== "string" || encodedRequest.length === 0) {
    return Result.err<never, PubkyAuthParseError>({ code: "missing_d" });
  }

  if (encodedRequest.length > PUBKY_AUTH_REQUEST_LIMITS.maximumEncodedDCodeUnits) {
    return Result.err<never, PubkyAuthParseError>({ code: "request_too_large" });
  }

  const decoded = decodeDParam(encodedRequest);
  if (Result.isError(decoded)) {
    return Result.err(decoded.error);
  }

  if (decoded.value.length > PUBKY_AUTH_REQUEST_LIMITS.maximumDecodedAuthUrlCodeUnits) {
    return Result.err<never, PubkyAuthParseError>({ code: "request_too_large" });
  }

  if (decoded.value === encodedRequest) {
    return Result.err<never, PubkyAuthParseError>({ code: "invalid_encoding" });
  }

  const authUrl = parseUrl(decoded.value);
  if (Result.isError(authUrl)) {
    return Result.err(authUrl.error);
  }

  if (authUrl.value.protocol !== PUBKY_AUTH_PROTOCOL) {
    return Result.err<never, PubkyAuthParseError>({ code: "unsupported_scheme" });
  }

  const authenticationMethod = parseAuthenticationMethod(authUrl.value);
  if (Result.isError(authenticationMethod)) {
    return Result.err(authenticationMethod.error);
  }

  const secret = authUrl.value.searchParams.get(PUBKY_AUTH_REQUEST_PARAMETERS.secret);
  if (!secret) {
    return Result.err<never, PubkyAuthParseError>({ code: "missing_secret" });
  }

  if (
    secret.length > PUBKY_AUTH_REQUEST_LIMITS.maximumSecretCodeUnits ||
    !isCanonicalPubkyAuthSecret(secret)
  ) {
    return Result.err<never, PubkyAuthParseError>({ code: "invalid_secret" });
  }

  const parameters = validatePubkyAuthRequestParameters(
    authUrl.value.searchParams,
    authenticationMethod.value,
  );
  if (Result.isError(parameters)) {
    return Result.err(parameters.error);
  }

  const grantParameters = validateGrantParameters(authUrl.value, authenticationMethod.value);
  if (Result.isError(grantParameters)) {
    return Result.err(grantParameters.error);
  }

  const urls = validatePubkyAuthUrls(authUrl.value);
  if (Result.isError(urls)) {
    return Result.err(urls.error);
  }

  const source = parseSource(authUrl.value);
  if (Result.isError(source)) {
    return Result.err(source.error);
  }

  const requestedCapabilities = authUrl.value.searchParams.get(
    PUBKY_AUTH_REQUEST_PARAMETERS.capabilities,
  );
  if (requestedCapabilities === null) {
    return Result.err<never, PubkyAuthParseError>({ code: "missing_capabilities" });
  }

  const capabilities = parsePubkyAuthCapabilities(requestedCapabilities);
  if (Result.isError(capabilities)) {
    return Result.err<never, PubkyAuthParseError>({ code: "invalid_capability" });
  }

  const normalizedCapabilities = requestedCapabilities.normalize("NFC");
  const sensitivePubkyAuthUrl =
    normalizedCapabilities === requestedCapabilities
      ? decoded.value
      : replaceCapabilities(authUrl.value, normalizedCapabilities);

  return Result.ok({
    authenticationMethod: authenticationMethod.value,
    capabilities: capabilities.value,
    callbacks: Object.freeze({ ...urls.value }),
    ...(source.value ? { source: source.value } : {}),
    sensitivePubkyAuthUrl,
  });
}

/** Validates encoded input without constructing an approval-capable request. */
export function validateEncodedPubkyAuthRequest(
  encodedRequest: unknown,
): ValidatePubkyAuthRequestResult {
  const parsed = parseEncodedPubkyAuthRequest(encodedRequest);
  return Result.isError(parsed) ? Result.err(parsed.error) : Result.ok();
}

function replaceCapabilities(authUrl: URL, capabilities: string): string {
  authUrl.searchParams.set(PUBKY_AUTH_REQUEST_PARAMETERS.capabilities, capabilities);
  return authUrl.toString();
}

function decodeDParam(d: string): ParseValueResult<string> {
  try {
    return Result.ok(decodeURIComponent(d));
  } catch {
    return Result.err<never, PubkyAuthParseError>({ code: "invalid_encoding" });
  }
}

function parseUrl(value: string): ParseValueResult<URL> {
  try {
    return Result.ok(new URL(value));
  } catch {
    return Result.err<never, PubkyAuthParseError>({ code: "invalid_url" });
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

  return Result.err<never, PubkyAuthParseError>({ code: "invalid_auth_request_path" });
}

function parseSource(authUrl: URL): ParseValueResult<string | undefined> {
  const encodedSource = getRawQueryValue(authUrl, PUBKY_AUTH_REQUEST_PARAMETERS.source);
  if (encodedSource === undefined) return Result.ok(undefined);

  let decodedSource = encodedSource;
  try {
    decodedSource = decodeURIComponent(encodedSource);
  } catch {
    // Match the SDK by leaving malformed percent encoding unchanged.
  }

  const source = decodedSource.trim().normalize("NFC");
  if (!source) return Result.ok(undefined);

  if (
    source.length > PUBKY_AUTH_REQUEST_LIMITS.maximumSourceCodeUnits ||
    UNSAFE_SOURCE_CHARACTERS.test(source)
  ) {
    return Result.err<never, PubkyAuthParseError>({ code: "invalid_source" });
  }

  return Result.ok(source);
}

function validatePubkyAuthRequestParameters(
  searchParams: URLSearchParams,
  authenticationMethod: PubkyAuthenticationMethod,
): ParseValueResult<void> {
  const seen = new Set<string>();
  const supportedParameters =
    authenticationMethod === "grant" ? GRANT_PARAMETERS : COMMON_PARAMETERS;

  for (const [name] of searchParams) {
    if (!supportedParameters.has(name)) {
      return Result.err<never, PubkyAuthParseError>({ code: "unsupported_parameter" });
    }

    if (seen.has(name)) {
      return Result.err<never, PubkyAuthParseError>({ code: "duplicate_parameter" });
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
    return Result.err<never, PubkyAuthParseError>({ code: "missing_client_id" });
  }
  if (utf8Length(clientId) > PUBKY_AUTH_REQUEST_LIMITS.maximumClientIdUtf8Bytes) {
    return Result.err<never, PubkyAuthParseError>({ code: "invalid_client_id" });
  }

  const clientPublicKey = url.searchParams.get(PUBKY_AUTH_REQUEST_PARAMETERS.clientPublicKey);
  if (clientPublicKey === null || clientPublicKey.length === 0) {
    return Result.err<never, PubkyAuthParseError>({ code: "missing_client_public_key" });
  }
  if (!isCanonicalPubkyPublicKey(clientPublicKey)) {
    return Result.err<never, PubkyAuthParseError>({ code: "invalid_client_public_key" });
  }

  return Result.ok();
}
