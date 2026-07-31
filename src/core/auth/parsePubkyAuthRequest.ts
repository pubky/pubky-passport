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

const PUBKY_AUTH_REQUEST_PARAMETERS = {
  relay: "relay",
  secret: "secret",
  capabilities: "caps",
  source: "x-source",
  success: "x-success",
  error: "x-error",
  cancel: "x-cancel",
} as const;
const SUPPORTED_PARAMETERS = new Set<string>(Object.values(PUBKY_AUTH_REQUEST_PARAMETERS));

export type PubkyAuthParseErrorCode =
  | "missing_d"
  | "request_too_large"
  | "invalid_encoding"
  | "invalid_url"
  | "unsupported_scheme"
  | "invalid_auth_request_path"
  | "missing_secret"
  | "invalid_secret"
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
  capabilities: PubkyAuthCapability[];
  callbacks: Readonly<ValidatedPubkyAuthCallbacks>;
  relayHost: string;
  relayOrigin: string;
  sensitivePubkyAuthUrl: string;
};

export type PubkyAuthParseResult = ResultType<ParsedPubkyAuthRequest, PubkyAuthParseError>;
export type PubkyAuthValidationResult = ResultType<void, PubkyAuthParseError>;
export type PubkyAuthRelayOriginResult = ResultType<string, PubkyAuthParseError>;

type ParseValueResult<T> = ResultType<T, PubkyAuthParseError>;

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

  const kind = parseAuthRequestKind(authUrl.value);
  if (Result.isError(kind)) {
    return Result.err(kind.error);
  }

  const secret = authUrl.value.searchParams.get(PUBKY_AUTH_REQUEST_PARAMETERS.secret);
  if (!secret) {
    return error("missing_secret", "Pubky auth request is missing a secret.");
  }

  if (secret.length > PUBKY_AUTH_REQUEST_LIMITS.secretLength) {
    return error("invalid_secret", "Pubky auth request secret exceeds the allowed size.");
  }

  const parameters = validatePubkyAuthRequestParameters(authUrl.value.searchParams);
  if (Result.isError(parameters)) {
    return Result.err(parameters.error);
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
    kind: kind.value,
    capabilities: capabilities.value,
    callbacks: Object.freeze({ ...urls.value.callbacks }),
    relayHost: urls.value.relayHost,
    relayOrigin: urls.value.relayOrigin,
    sensitivePubkyAuthUrl: authUrl.value.href,
  });
}

export function validatePubkyAuthRequest(d: unknown): PubkyAuthValidationResult {
  const parsed = parsePubkyAuthRequest(d);
  return Result.isError(parsed) ? Result.err(parsed.error) : Result.ok();
}

export function parsePubkyAuthRelayOrigin(d: unknown): PubkyAuthRelayOriginResult {
  const parsed = parsePubkyAuthRequest(d);
  return Result.isError(parsed) ? Result.err(parsed.error) : Result.ok(parsed.value.relayOrigin);
}

export function extractRawPubkyAuthRequestQueryValue(
  search: string,
): { valid: true; value?: string } | { valid: false } {
  let value: string | undefined;

  for (const parameter of search.slice(1).split("&")) {
    const separator = parameter.indexOf("=");
    const name = separator === -1 ? parameter : parameter.slice(0, separator);
    if (name !== "d") continue;
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

function parseAuthRequestKind(url: URL): ParseValueResult<PubkyAuthRequestKind> {
  if (url.hostname === "signin" && url.pathname === "") {
    return Result.ok("signin");
  }

  if (url.hostname === "" && url.pathname === "/") {
    return Result.ok("signin");
  }

  return error("invalid_auth_request_path", "Pubky auth request path is not supported.");
}

function validatePubkyAuthRequestParameters(searchParams: URLSearchParams): ParseValueResult<void> {
  const seen = new Set<string>();

  for (const [name] of searchParams) {
    if (!SUPPORTED_PARAMETERS.has(name)) {
      return error("unsupported_parameter", "Pubky auth request contains an unsupported parameter.");
    }

    if (seen.has(name)) {
      return error("duplicate_parameter", "Pubky auth request contains a duplicate parameter.");
    }

    seen.add(name);
  }

  return Result.ok();
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
