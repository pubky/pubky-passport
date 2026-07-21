import { Result, type Err, type Result as ResultType } from "better-result";

export type PubkyAuthCallbacks = {
  success?: string;
  error?: string;
  cancel?: string;
};

export type PubkyAuthUrlValidationErrorCode =
  | "missing_relay"
  | "invalid_relay"
  | "invalid_callback";

export type PubkyAuthUrlValidationError = {
  code: PubkyAuthUrlValidationErrorCode;
  message: string;
};

export type PubkyAuthUrlValidationOptions = {
  // Route/controller wiring must only enable this in development.
  allowLocalhostCallbacks?: boolean;
};

export type PubkyAuthUrlValidationResult = ResultType<{
  relay: string;
  callbacks: PubkyAuthCallbacks;
  requestingAppDisplayName?: string;
}, PubkyAuthUrlValidationError>;

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

type UrlParseResult = ResultType<URL, "invalid_url">;

export function validatePubkyAuthUrls(
  authUrl: URL,
  options: PubkyAuthUrlValidationOptions = {},
): PubkyAuthUrlValidationResult {
  const relay = validateRelayUrl(authUrl.searchParams.get("relay"));
  if (Result.isError(relay)) {
    return Result.err(relay.error);
  }

  const callbacks = validateCallbacks(authUrl, options);
  if (Result.isError(callbacks)) {
    return Result.err(callbacks.error);
  }

  const requestingAppDisplayName = deriveDisplayDomain(callbacks.value);

  return Result.ok({
    relay: relay.value.href,
    callbacks: callbacks.value,
    ...(requestingAppDisplayName ? { requestingAppDisplayName } : {}),
  });
}

export function validateRelayUrl(value: string | null): ResultType<URL, PubkyAuthUrlValidationError> {
  if (!value) {
    return error("missing_relay", "Pubky auth request is missing relay.");
  }

  const parsed = parseAbsoluteUrl(value);
  if (Result.isError(parsed) || parsed.value.protocol !== "https:") {
    return error("invalid_relay", "Pubky auth request relay is not an allowed URL.");
  }

  return Result.ok(parsed.value);
}

function deriveDisplayDomain(callbacks: PubkyAuthCallbacks): string | undefined {
  const displayCallback = callbacks.success ?? callbacks.error ?? callbacks.cancel;
  if (!displayCallback) {
    return undefined;
  }

  // Invariant: callback values are canonical URL.href strings produced by
  // validateCallbacks, so re-parsing succeeds under the normal flow. We parse
  // defensively anyway so a future change to the callback source can never turn
  // display-name derivation into an unhandled throw in this signing path.
  const parsedCallback = parseAbsoluteUrl(displayCallback);
  if (Result.isError(parsedCallback)) {
    return undefined;
  }

  // URL.hostname returns punycode ASCII (e.g. "xn--...") for internationalized
  // domains. We intentionally display that ASCII form so a Unicode homograph
  // cannot spoof the requesting domain shown to the user before signing.
  return parsedCallback.value.hostname || undefined;
}

function validateCallbacks(
  authUrl: URL,
  options: PubkyAuthUrlValidationOptions,
): ResultType<PubkyAuthCallbacks, PubkyAuthUrlValidationError> {
  const success = validateOptionalCallback(authUrl.searchParams.get(CALLBACK_QUERY_NAMES.success), options);
  if (Result.isError(success)) {
    return Result.err(success.error);
  }

  const errorCallback = validateOptionalCallback(authUrl.searchParams.get(CALLBACK_QUERY_NAMES.error), options);
  if (Result.isError(errorCallback)) {
    return Result.err(errorCallback.error);
  }

  const cancel = validateOptionalCallback(authUrl.searchParams.get(CALLBACK_QUERY_NAMES.cancel), options);
  if (Result.isError(cancel)) {
    return Result.err(cancel.error);
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

  return Result.ok(callbacks);
}

function validateOptionalCallback(
  value: string | null,
  options: PubkyAuthUrlValidationOptions,
): ResultType<URL | undefined, PubkyAuthUrlValidationError> {
  if (!value) {
    return Result.ok(undefined);
  }

  const parsed = parseAbsoluteUrl(value);
  if (Result.isError(parsed) || !isAllowedCallbackUrl(parsed.value, options)) {
    return error("invalid_callback", "Pubky auth request callback is not an allowed URL.");
  }

  return Result.ok(parsed.value);
}

function isAllowedCallbackUrl(url: URL, options: PubkyAuthUrlValidationOptions): boolean {
  if (UNSAFE_CALLBACK_PROTOCOLS.has(url.protocol)) {
    return false;
  }

  if (url.protocol === "https:") {
    return true;
  }

  return Boolean(options.allowLocalhostCallbacks && url.protocol === "http:" && isLocalhost(url.hostname));
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function parseAbsoluteUrl(value: string): UrlParseResult {
  try {
    const url = new URL(value);
    return Result.ok(url);
  } catch {
    return Result.err("invalid_url");
  }
}

function error(
  code: PubkyAuthUrlValidationErrorCode,
  message: string,
): Err<never, PubkyAuthUrlValidationError> {
  return Result.err<never, PubkyAuthUrlValidationError>({ code, message });
}
