import {
  parsePubkyAuthCapabilities,
  type PubkyAuthCapability,
  type PubkyAuthCapabilitiesParseError,
} from "./parsePubkyAuthCapabilities";

export type { PubkyAuthCapability } from "./parsePubkyAuthCapabilities";

export type PubkyAuthRequestKind = "signin";

export type PubkyAuthCallbackName = "success" | "error" | "cancel";

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

export type PubkyAuthCallbacks = {
  success?: string;
  error?: string;
  cancel?: string;
};

export type PubkyAuthRequest = {
  kind: PubkyAuthRequestKind;
  relay: string;
  secret: string;
  capabilities: PubkyAuthCapability[];
  callbacks: PubkyAuthCallbacks;
  source?: string;
  requestingAppDisplayName: string;
};

export type PubkyAuthParseResult =
  | { ok: true; request: PubkyAuthRequest }
  | { ok: false; error: PubkyAuthParseError };

type ParseValueResult<T> = { ok: true; value: T } | { ok: false; error: PubkyAuthParseError };

export type ParsePubkyAuthRequestOptions = {
  // Route/controller wiring must only enable this in development.
  allowLocalhostCallbacks?: boolean;
};

const PUBKY_AUTH_PROTOCOL = "pubkyauth:";

const CALLBACK_QUERY_NAMES = {
  success: "x-success",
  error: "x-error",
  cancel: "x-cancel",
} as const;

const UNSAFE_CALLBACK_PROTOCOLS = new Set([
  "javascript:",
  "data:",
  "file:",
  "blob:",
]);

export function parsePubkyAuthRequest(
  d: unknown,
  options: ParsePubkyAuthRequestOptions = {},
): PubkyAuthParseResult {
  if (typeof d !== "string" || d.length === 0) {
    return error("missing_d", "Missing encoded Pubky auth request.");
  }

  const decoded = decodeDParam(d);
  if (!decoded.ok) {
    return decoded;
  }

  if (decoded.value === d) {
    return error("invalid_encoding", "Pubky auth request must be URL-encoded.");
  }

  const authUrl = parseUrl(decoded.value);
  if (!authUrl.ok) {
    return authUrl;
  }

  if (authUrl.value.protocol !== PUBKY_AUTH_PROTOCOL) {
    return error("unsupported_scheme", "Pubky auth request must use pubkyauth scheme.");
  }

  const kind = parseAuthRequestKind(authUrl.value);
  if (!kind.ok) {
    return kind;
  }

  const relay = parseRequiredUrlParam(authUrl.value, "relay", "missing_relay", "invalid_relay");
  if (!relay.ok) {
    return relay;
  }

  if (relay.value.protocol !== "https:") {
    return error("invalid_relay", "Relay URL must use HTTPS.");
  }

  const secret = authUrl.value.searchParams.get("secret");
  if (!secret) {
    return error("missing_secret", "Pubky auth request is missing a secret.");
  }

  const capabilities = parsePubkyAuthCapabilities(authUrl.value.searchParams.get("caps"));
  if (!capabilities.ok) {
    return mapCapabilitiesError(capabilities.error);
  }

  const callbacks = parseCallbacks(authUrl.value, options);
  if (!callbacks.ok) {
    return callbacks;
  }

  return {
    ok: true,
    request: {
      kind: kind.value,
      relay: relay.value.href,
      secret,
      capabilities: capabilities.capabilities,
      callbacks: callbacks.value,
      source: parseOptionalSource(authUrl.value.searchParams.get("x-source")),
      requestingAppDisplayName: getDisplayName(callbacks.value.success, relay.value),
    },
  };
}

function decodeDParam(d: string): ParseValueResult<string> {
  try {
    return { ok: true, value: decodeURIComponent(d) };
  } catch {
    return error("invalid_encoding", "Pubky auth request is not valid URL encoding.");
  }
}

function parseUrl(value: string): ParseValueResult<URL> {
  try {
    return { ok: true, value: new URL(value) };
  } catch {
    return error("invalid_url", "Pubky auth request is not a valid URL.");
  }
}

function parseAuthRequestKind(url: URL): ParseValueResult<PubkyAuthRequestKind> {
  if (url.hostname === "signin" && url.pathname === "") {
    return { ok: true, value: "signin" };
  }

  if (url.hostname === "" && url.pathname === "/") {
    return { ok: true, value: "signin" };
  }

  return error("invalid_auth_request_path", "Pubky auth request path is not supported.");
}

function parseRequiredUrlParam(
  url: URL,
  paramName: string,
  missingCode: PubkyAuthParseErrorCode,
  invalidCode: PubkyAuthParseErrorCode,
): ParseValueResult<URL> {
  const value = url.searchParams.get(paramName);
  if (!value) {
    return error(missingCode, `Pubky auth request is missing ${paramName}.`);
  }

  const parsed = parseUrl(value);
  if (!parsed.ok) {
    return error(invalidCode, `Pubky auth request ${paramName} is not a valid URL.`);
  }

  return parsed;
}

function mapCapabilitiesError(capabilitiesError: PubkyAuthCapabilitiesParseError): PubkyAuthParseResult {
  if (capabilitiesError.code === "missing_capabilities") {
    return error("missing_capabilities", capabilitiesError.message);
  }

  return error("invalid_capability", "Pubky auth request contains an invalid capability.");
}

function parseCallbacks(
  url: URL,
  options: ParsePubkyAuthRequestOptions,
): ParseValueResult<PubkyAuthCallbacks> {
  const success = parseOptionalCallback(url, CALLBACK_QUERY_NAMES.success, options);
  if (!success.ok) {
    return success;
  }

  const errorCallback = parseOptionalCallback(url, CALLBACK_QUERY_NAMES.error, options);
  if (!errorCallback.ok) {
    return errorCallback;
  }

  const cancel = parseOptionalCallback(url, CALLBACK_QUERY_NAMES.cancel, options);
  if (!cancel.ok) {
    return cancel;
  }

  const callbacks: PubkyAuthCallbacks = {};

  if (success.value) {
    callbacks.success = success.value.href;
  }

  if (errorCallback.value) {
    callbacks.error = errorCallback.value.href;
  }

  if (cancel.value) {
    callbacks.cancel = cancel.value.href;
  }

  return {
    ok: true,
    value: callbacks,
  };
}

function parseOptionalCallback(
  url: URL,
  queryName: string,
  options: ParsePubkyAuthRequestOptions,
): ParseValueResult<URL | undefined> {
  const value = url.searchParams.get(queryName);
  if (!value) {
    return { ok: true, value: undefined };
  }

  const parsed = parseUrl(value);
  if (!parsed.ok || !isAllowedCallbackUrl(parsed.value, options)) {
    return error("invalid_callback", `Pubky auth request ${queryName} is not an allowed callback URL.`);
  }

  return parsed;
}

function isAllowedCallbackUrl(url: URL, options: ParsePubkyAuthRequestOptions): boolean {
  if (UNSAFE_CALLBACK_PROTOCOLS.has(url.protocol)) {
    return false;
  }

  if (url.protocol === "https:") {
    return true;
  }

  return Boolean(options.allowLocalhostCallbacks && url.protocol === "http:" && isLocalhost(url.hostname));
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function parseOptionalSource(source: string | null): string | undefined {
  const trimmed = source?.trim();
  return trimmed ? trimmed : undefined;
}

function getDisplayName(successCallback: string | undefined, relay: URL): string {
  if (!successCallback) {
    return relay.hostname;
  }

  const parsedSuccessCallback = new URL(successCallback);
  return parsedSuccessCallback.hostname || relay.hostname;
}

function error(code: PubkyAuthParseErrorCode, message: string): { ok: false; error: PubkyAuthParseError } {
  return { ok: false, error: { code, message } };
}
