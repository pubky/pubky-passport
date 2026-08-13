import "client-only";

import { Result, type Err, type Result as ResultType } from "better-result";

import {
  parsePubkyAuthCapabilities,
  type PubkyAuthCapability,
  type PubkyAuthCapabilitiesParseError,
} from "./parsePubkyAuthCapabilities";
import {
  validatePubkyAuthUrls,
  type ValidatedPubkyAuthCallbacks,
  type PubkyAuthUrlValidationError,
} from "./validatePubkyAuthUrls";
import { PUBKY_AUTH_REQUEST_LIMITS } from "./pubkyAuthRequestLimits";

export type PubkyAuthRequestKind = "signin";
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
  message: string;
};

export type ParsedPubkyAuthRequest = {
  kind: PubkyAuthRequestKind;
  authenticationMethod: PubkyAuthenticationMethod;
  capabilities: PubkyAuthCapability[];
  clientId?: string;
  callbacks: Readonly<ValidatedPubkyAuthCallbacks>;
  relayHost: string;
  relayOrigin: string;
  sensitivePubkyAuthUrl: string;
};

export type PubkyAuthParseResult = ResultType<ParsedPubkyAuthRequest, PubkyAuthParseError>;
export type PubkyAuthValidationResult = ResultType<void, PubkyAuthParseError>;

type ParseValueResult<Value> = ResultType<Value, PubkyAuthParseError>;

const PUBKY_AUTH_PROTOCOL = "pubkyauth:";

export function parsePubkyAuthRequest(
  d: unknown,
): PubkyAuthParseResult {
  if (typeof d !== "string" || d.length === 0) {
    return error("missing_d", "Missing encoded Pubky auth request.");
  }

  if (d.length > PUBKY_AUTH_REQUEST_LIMITS.encodedDLength) {
    return error("request_too_large", "Encoded Pubky auth request exceeds the allowed size.");
  }

  const decoded = decodeDParam(d);
  if (Result.isError(decoded)) {
    return Result.err(decoded.error);
  }

  if (decoded.value.length > PUBKY_AUTH_REQUEST_LIMITS.decodedAuthUrlLength) {
    return error("request_too_large", "Pubky auth request exceeds the allowed size.");
  }

  if (decoded.value === d) {
    return error("invalid_encoding", "Pubky auth request must be URL-encoded.");
  }

  const authUrl = parseUrl(decoded.value);
  if (Result.isError(authUrl)) {
    return Result.err(authUrl.error);
  }

  if (authUrl.value.protocol !== PUBKY_AUTH_PROTOCOL) {
    return error("unsupported_scheme", "Pubky auth request must use pubkyauth scheme.");
  }

  const intent = parseAuthRequestIntent(authUrl.value);
  if (Result.isError(intent)) {
    return Result.err(intent.error);
  }

  const secret = authUrl.value.searchParams.get(PUBKY_AUTH_REQUEST_PARAMETERS.secret);
  if (!secret) {
    return error("missing_secret", "Pubky auth request is missing a secret.");
  }

  if (
    secret.length > PUBKY_AUTH_REQUEST_LIMITS.secretLength ||
    !isCanonicalAuthSecret(secret)
  ) {
    return error("invalid_secret", "Pubky auth request secret is invalid.");
  }

  const parameters = validatePubkyAuthRequestParameters(
    authUrl.value.searchParams,
    intent.value.authenticationMethod,
  );
  if (Result.isError(parameters)) {
    return Result.err(parameters.error);
  }

  const grant = parseGrantParameters(authUrl.value, intent.value.authenticationMethod);
  if (Result.isError(grant)) {
    return Result.err(grant.error);
  }

  const urls = validatePubkyAuthUrls(authUrl.value);
  if (Result.isError(urls)) {
    return mapUrlValidationError(urls.error);
  }

  const capabilities = parsePubkyAuthCapabilities(authUrl.value.searchParams.get(PUBKY_AUTH_REQUEST_PARAMETERS.capabilities));
  if (Result.isError(capabilities)) {
    return mapCapabilitiesError(capabilities.error);
  }

  return Result.ok({
    kind: intent.value.kind,
    authenticationMethod: intent.value.authenticationMethod,
    capabilities: capabilities.value,
    ...(grant.value ? { clientId: grant.value.clientId } : {}),
    callbacks: Object.freeze({ ...urls.value.callbacks }),
    relayHost: urls.value.relayHost,
    relayOrigin: urls.value.relayOrigin,
    sensitivePubkyAuthUrl: decoded.value,
  });
}

export function validatePubkyAuthRequest(
  d: unknown,
): PubkyAuthValidationResult {
  const parsed = parsePubkyAuthRequest(d);
  return Result.isError(parsed) ? Result.err(parsed.error) : Result.ok();
}

export function extractRawPubkyAuthRequestFragmentValue(
  hash: string,
): { valid: true; value?: string } | { valid: false } {
  if (hash.length > PUBKY_AUTH_REQUEST_LIMITS.encodedDLength + "#d=".length) {
    return { valid: false };
  }
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (fragment.length === 0) return { valid: true };
  let value: string | undefined;

  for (const parameter of fragment.split("&")) {
    const separator = parameter.indexOf("=");
    const name = separator === -1 ? parameter : parameter.slice(0, separator);
    if (name !== "d") return { valid: false };
    if (separator === -1 || value !== undefined) return { valid: false };
    value = parameter.slice(separator + 1);
  }

  return value === undefined ? { valid: true } : { valid: true, value };
}

function decodeDParam(d: string): ParseValueResult<string> {
  try {
    return Result.ok(decodeURIComponent(d));
  } catch {
    return error("invalid_encoding", "Pubky auth request is not valid URL encoding.");
  }
}

function parseUrl(value: string): ParseValueResult<URL> {
  try {
    return Result.ok(new URL(value));
  } catch {
    return error("invalid_url", "Pubky auth request is not a valid URL.");
  }
}

function parseAuthRequestIntent(url: URL): ParseValueResult<{
  kind: PubkyAuthRequestKind;
  authenticationMethod: PubkyAuthenticationMethod;
}> {
  if (url.hostname === "signin" && url.pathname === "") {
    return Result.ok({ kind: "signin", authenticationMethod: "cookie" });
  }

  if (url.hostname === "signin_grant" && url.pathname === "") {
    return Result.ok({ kind: "signin", authenticationMethod: "grant" });
  }

  if (url.hostname === "" && url.pathname === "/") {
    return Result.ok({ kind: "signin", authenticationMethod: "cookie" });
  }

  return error("invalid_auth_request_path", "Pubky auth request path is not supported.");
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
      return error("unsupported_parameter", "Pubky auth request contains an unsupported parameter.");
    }

    if (seen.has(name)) {
      return error("duplicate_parameter", "Pubky auth request contains a duplicate parameter.");
    }

    seen.add(name);
  }

  return Result.ok();
}

function parseGrantParameters(
  url: URL,
  authenticationMethod: PubkyAuthenticationMethod,
): ParseValueResult<{ clientId: string } | undefined> {
  if (authenticationMethod === "cookie") return Result.ok(undefined);

  const clientId = url.searchParams.get(PUBKY_AUTH_REQUEST_PARAMETERS.clientId);
  if (clientId === null || clientId.length === 0) {
    return error("missing_client_id", "Grant authentication request is missing a client ID.");
  }
  if (utf8Length(clientId) > 253) {
    return error("invalid_client_id", "Grant authentication request client ID is invalid.");
  }

  const clientPublicKey = url.searchParams.get(PUBKY_AUTH_REQUEST_PARAMETERS.clientPublicKey);
  if (clientPublicKey === null || clientPublicKey.length === 0) {
    return error("missing_client_public_key", "Grant authentication request is missing a client public key.");
  }
  if (!isCanonicalPublicKey(clientPublicKey)) {
    return error("invalid_client_public_key", "Grant authentication request client public key is invalid.");
  }

  return Result.ok({ clientId });
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

function mapCapabilitiesError(capabilitiesError: PubkyAuthCapabilitiesParseError): PubkyAuthParseResult {
  if (capabilitiesError.code === "missing_capabilities") {
    return error("missing_capabilities", capabilitiesError.message);
  }

  return error("invalid_capability", "Pubky auth request contains an invalid capability.");
}

function mapUrlValidationError(urlError: PubkyAuthUrlValidationError): PubkyAuthParseResult {
  return error(urlError.code, urlError.message);
}
function error(
  code: PubkyAuthParseErrorCode,
  message: string,
): Err<never, PubkyAuthParseError> {
  return Result.err<never, PubkyAuthParseError>({ code, message });
}
