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

export type PubkyAuthUrlValidationResult =
  | {
      ok: true;
      relay: string;
      callbacks: PubkyAuthCallbacks;
      requestingAppDisplayName?: string;
    }
  | { ok: false; error: PubkyAuthUrlValidationError };

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

type UrlParseResult = { ok: true; url: URL } | { ok: false };

export function validatePubkyAuthUrls(
  authUrl: URL,
  options: PubkyAuthUrlValidationOptions = {},
): PubkyAuthUrlValidationResult {
  const relay = validateRelayUrl(authUrl.searchParams.get("relay"));
  if (!relay.ok) {
    return relay;
  }

  const callbacks = validateCallbacks(authUrl, options);
  if (!callbacks.ok) {
    return callbacks;
  }

  return {
    ok: true,
    relay: relay.url.href,
    callbacks: callbacks.callbacks,
    requestingAppDisplayName: deriveDisplayDomain(callbacks.callbacks),
  };
}

export function validateRelayUrl(value: string | null):
  | { ok: true; url: URL }
  | { ok: false; error: PubkyAuthUrlValidationError } {
  if (!value) {
    return error("missing_relay", "Pubky auth request is missing relay.");
  }

  const parsed = parseAbsoluteUrl(value);
  if (!parsed.ok || parsed.url.protocol !== "https:") {
    return error("invalid_relay", "Pubky auth request relay is not an allowed URL.");
  }

  return parsed;
}

function deriveDisplayDomain(callbacks: PubkyAuthCallbacks): string | undefined {
  const displayCallback = callbacks.success ?? callbacks.error ?? callbacks.cancel;
  if (!displayCallback) {
    return undefined;
  }

  const parsedCallback = new URL(displayCallback);
  return parsedCallback.hostname || undefined;
}

function validateCallbacks(
  authUrl: URL,
  options: PubkyAuthUrlValidationOptions,
): { ok: true; callbacks: PubkyAuthCallbacks } | { ok: false; error: PubkyAuthUrlValidationError } {
  const success = validateOptionalCallback(authUrl.searchParams.get(CALLBACK_QUERY_NAMES.success), options);
  if (!success.ok) {
    return success;
  }

  const errorCallback = validateOptionalCallback(authUrl.searchParams.get(CALLBACK_QUERY_NAMES.error), options);
  if (!errorCallback.ok) {
    return errorCallback;
  }

  const cancel = validateOptionalCallback(authUrl.searchParams.get(CALLBACK_QUERY_NAMES.cancel), options);
  if (!cancel.ok) {
    return cancel;
  }

  const callbacks: PubkyAuthCallbacks = {};
  if (success.url) {
    callbacks.success = success.url.href;
  }

  if (errorCallback.url) {
    callbacks.error = errorCallback.url.href;
  }

  if (cancel.url) {
    callbacks.cancel = cancel.url.href;
  }

  return { ok: true, callbacks };
}

function validateOptionalCallback(
  value: string | null,
  options: PubkyAuthUrlValidationOptions,
): { ok: true; url?: URL } | { ok: false; error: PubkyAuthUrlValidationError } {
  if (!value) {
    return { ok: true };
  }

  const parsed = parseAbsoluteUrl(value);
  if (!parsed.ok || !isAllowedCallbackUrl(parsed.url, options)) {
    return error("invalid_callback", "Pubky auth request callback is not an allowed URL.");
  }

  return { ok: true, url: parsed.url };
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
    return { ok: true, url };
  } catch {
    return { ok: false };
  }
}

function error(
  code: PubkyAuthUrlValidationErrorCode,
  message: string,
): { ok: false; error: PubkyAuthUrlValidationError } {
  return { ok: false, error: { code, message } };
}
