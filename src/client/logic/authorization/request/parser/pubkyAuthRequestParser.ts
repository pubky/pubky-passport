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
  clientId?: string;
  sensitivePubkyAuthUrl: string;
};

export type PubkyAuthParseResult = ResultType<ParsedPubkyAuthRequest, PubkyAuthParseError>;
export type ValidatePubkyAuthRequestResult = ResultType<void, PubkyAuthParseError>;

type ParseValueResult<Value> = ResultType<Value, PubkyAuthParseError>;

const PUBKY_AUTH_PROTOCOL = "pubkyauth:";
export const UNSAFE_SOURCE_CHARACTERS =
  /[\p{Cc}\p{Zl}\p{Zp}\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;
/**
 * What the URL parser silently drops from a request: TAB, LF and CR anywhere, and C0 controls or
 * spaces at either end. A parser that does not drop them (a raw-string rewrite, another signer)
 * would read different parameters than the review, so a request carrying them is rejected.
 */
const URL_STRIPPED_CHARACTERS = /[\u0000-\u001f\u007f]|^ | $/u;

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

  if (URL_STRIPPED_CHARACTERS.test(decoded.value)) {
    return Result.err<never, PubkyAuthParseError>({ code: "invalid_url" });
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

  const parameters = validatePubkyAuthRequestParameters(authUrl.value, authenticationMethod.value);
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

  // The review shows exactly the caps the signed URL carries: the URL is built first, then its
  // caps are read back with the same parser the review and the SDK use, and only those are shown.
  const normalizedCapabilities = requestedCapabilities.normalize("NFC");
  const sensitivePubkyAuthUrl =
    normalizedCapabilities === requestedCapabilities
      ? decoded.value
      : replaceCapabilities(decoded.value, normalizedCapabilities);
  const signedCapabilities = readSignedCapabilities(
    authUrl.value,
    sensitivePubkyAuthUrl,
    normalizedCapabilities,
  );
  if (signedCapabilities === undefined) {
    return Result.err<never, PubkyAuthParseError>({ code: "invalid_capability" });
  }

  const capabilities = parsePubkyAuthCapabilities(signedCapabilities);
  if (Result.isError(capabilities)) {
    return Result.err<never, PubkyAuthParseError>({ code: "invalid_capability" });
  }
  const clientId = authUrl.value.searchParams.get(PUBKY_AUTH_REQUEST_PARAMETERS.clientId);

  return Result.ok({
    authenticationMethod: authenticationMethod.value,
    capabilities: capabilities.value,
    callbacks: Object.freeze({ ...urls.value }),
    ...(source.value ? { source: source.value } : {}),
    ...(clientId ? { clientId } : {}),
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

/**
 * Rewrites only the `caps` value and leaves every other byte of the request as the app sent it.
 * Re-serialising through URLSearchParams would form-encode the other values (`%20` becomes `+`),
 * and Pubky Ring decodes with decodeURIComponent, which keeps the `+`. Every parameter name was
 * already checked to be spelled exactly as supported, so the one `caps` pair is found by name.
 */
function replaceCapabilities(authUrl: string, capabilities: string): string {
  const queryStart = authUrl.indexOf("?");
  const hashStart = authUrl.indexOf("#", queryStart);
  const queryEnd = hashStart === -1 ? authUrl.length : hashStart;
  const pairs = authUrl.slice(queryStart + 1, queryEnd).split("&");
  const encoded = encodeURIComponent(capabilities).replace(/%2F|%3A|%2C/gi, decodeURIComponent);
  const replaced = pairs.map((pair) =>
    rawParameterName(pair) === PUBKY_AUTH_REQUEST_PARAMETERS.capabilities
      ? `${PUBKY_AUTH_REQUEST_PARAMETERS.capabilities}=${encoded}`
      : pair,
  );
  return `${authUrl.slice(0, queryStart + 1)}${replaced.join("&")}${authUrl.slice(queryEnd)}`;
}

/**
 * The caps the signed URL carries, read back as the SDK will parse it, or `undefined` unless they
 * are the NFC caps the review is built from and every other parameter reads exactly as before.
 * Each capability must also be NFC on its own, so parsing one by one cannot change a path again.
 */
function readSignedCapabilities(
  requestUrl: URL,
  signedUrl: string,
  normalizedCapabilities: string,
): string | undefined {
  let signed: URL;
  try {
    signed = new URL(signedUrl);
  } catch {
    return undefined;
  }
  const expected = [...requestUrl.searchParams].map(([name, value]) =>
    name === PUBKY_AUTH_REQUEST_PARAMETERS.capabilities
      ? [name, normalizedCapabilities]
      : [name, value],
  );
  const actual = [...signed.searchParams];
  const same =
    actual.length === expected.length &&
    actual.every(
      ([name, value], index) => expected[index]?.[0] === name && expected[index]?.[1] === value,
    );
  const capabilities = signed.searchParams.get(PUBKY_AUTH_REQUEST_PARAMETERS.capabilities);
  if (!same || capabilities !== normalizedCapabilities) return undefined;
  return capabilities.split(",").every((capability) => capability === capability.normalize("NFC"))
    ? capabilities
    : undefined;
}

/** The raw name of one `name=value` query pair, before any percent decoding. */
function rawParameterName(pair: string): string {
  const separator = pair.indexOf("=");
  return separator === -1 ? pair : pair.slice(0, separator);
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

/** Normalizes a display label without changing authorization parameter acceptance. */
export function displaySafeLabel(value: string): string | undefined {
  const label = value.trim().normalize("NFC");
  return !label || UNSAFE_SOURCE_CHARACTERS.test(label) ? undefined : label;
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

  const source = displaySafeLabel(decodedSource);
  if (source === undefined && !decodedSource.trim()) return Result.ok(undefined);
  if (source === undefined || source.length > PUBKY_AUTH_REQUEST_LIMITS.maximumSourceCodeUnits) {
    return Result.err<never, PubkyAuthParseError>({ code: "invalid_source" });
  }

  return Result.ok(source);
}

/**
 * Accepts only supported parameter names, each once and spelled exactly (`c%61ps` or `x-s%6Furce`
 * is rejected), so a raw-string reader and a URL parser always find the same parameters.
 */
function validatePubkyAuthRequestParameters(
  url: URL,
  authenticationMethod: PubkyAuthenticationMethod,
): ParseValueResult<void> {
  const seen = new Set<string>();
  const supportedParameters =
    authenticationMethod === "grant" ? GRANT_PARAMETERS : COMMON_PARAMETERS;
  const query = url.search.startsWith("?") ? url.search.slice(1) : url.search;

  // URLSearchParams skips empty pairs (`&&`, a trailing `&`) as well.
  for (const pair of query.split("&").filter((pair) => pair.length > 0)) {
    const name = rawParameterName(pair);
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
