import { Result, type Err, type Result as ResultType } from "better-result";

import {
  parsePubkyAuthCapabilities,
  type PubkyAuthCapability,
  type PubkyAuthCapabilitiesParseError,
} from "./parsePubkyAuthCapabilities";
import {
  validatePubkyAuthUrls,
  type PubkyAuthCallbacks,
  type PubkyAuthUrlValidationError,
  type PubkyAuthUrlValidationOptions,
} from "./validatePubkyAuthUrls";

export type { PubkyAuthCapability } from "./parsePubkyAuthCapabilities";
export type { PubkyAuthCallbacks } from "./validatePubkyAuthUrls";

export type PubkyAuthRequestKind = "signin";

declare const sensitivePubkyAuthRequestSecretBrand: unique symbol;

export type SensitivePubkyAuthRequestSecret = string & {
  readonly [sensitivePubkyAuthRequestSecretBrand]: "SensitivePubkyAuthRequestSecret";
};

export type PubkyAuthParseErrorCode =
  | "missing_d"
  | "invalid_encoding"
  | "invalid_url"
  | "unsupported_scheme"
  | "invalid_auth_request_path"
  | "missing_relay"
  | "invalid_relay"
  | "missing_secret"
  | "missing_capabilities"
  | "invalid_capability"
  | "invalid_callback";

export type PubkyAuthParseError = {
  code: PubkyAuthParseErrorCode;
  message: string;
};

export type PubkyAuthRequest = {
  kind: PubkyAuthRequestKind;
  relay: string;
  sensitiveSecret: SensitivePubkyAuthRequestSecret;
  capabilities: PubkyAuthCapability[];
  callbacks: PubkyAuthCallbacks;
  source?: string;
  requestingAppDisplayName?: string;
};

export type PubkyAuthParseResult = ResultType<PubkyAuthRequest, PubkyAuthParseError>;

type ParseValueResult<T> = ResultType<T, PubkyAuthParseError>;

export type ParsePubkyAuthRequestOptions = PubkyAuthUrlValidationOptions;

const PUBKY_AUTH_PROTOCOL = "pubkyauth:";

export function parsePubkyAuthRequest(
  d: unknown,
  options: ParsePubkyAuthRequestOptions = {},
): PubkyAuthParseResult {
  if (typeof d !== "string" || d.length === 0) {
    return error("missing_d", "Missing encoded Pubky auth request.");
  }

  const decoded = decodeDParam(d);
  if (Result.isError(decoded)) {
    return Result.err(decoded.error);
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

  const urls = validatePubkyAuthUrls(authUrl.value, options);
  if (Result.isError(urls)) {
    return mapUrlValidationError(urls.error);
  }

  const secret = authUrl.value.searchParams.get("secret");
  if (!secret) {
    return error("missing_secret", "Pubky auth request is missing a secret.");
  }

  const capabilities = parsePubkyAuthCapabilities(authUrl.value.searchParams.get("caps"));
  if (Result.isError(capabilities)) {
    return mapCapabilitiesError(capabilities.error);
  }

  const source = parseOptionalSource(authUrl.value.searchParams.get("x-source"));
  const request: PubkyAuthRequest = {
    kind: kind.value,
    relay: urls.value.relay,
    sensitiveSecret: secret as SensitivePubkyAuthRequestSecret,
    capabilities: capabilities.value,
    callbacks: urls.value.callbacks,
  };

  if (source) {
    request.source = source;
  }

  if (urls.value.requestingAppDisplayName) {
    request.requestingAppDisplayName = urls.value.requestingAppDisplayName;
  }

  return Result.ok(request);
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

function mapCapabilitiesError(capabilitiesError: PubkyAuthCapabilitiesParseError): PubkyAuthParseResult {
  if (capabilitiesError.code === "missing_capabilities") {
    return error("missing_capabilities", capabilitiesError.message);
  }

  return error("invalid_capability", "Pubky auth request contains an invalid capability.");
}

function mapUrlValidationError(urlError: PubkyAuthUrlValidationError): PubkyAuthParseResult {
  return error(urlError.code, urlError.message);
}

function parseOptionalSource(source: string | null): string | undefined {
  const trimmed = source?.trim();
  return trimmed ? trimmed : undefined;
}

function error(
  code: PubkyAuthParseErrorCode,
  message: string,
): Err<never, PubkyAuthParseError> {
  return Result.err<never, PubkyAuthParseError>({ code, message });
}
