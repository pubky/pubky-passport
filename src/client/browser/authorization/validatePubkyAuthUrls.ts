import "client-only";

import { Result, type Err, type Result as ResultType } from "better-result";

import { PUBKY_AUTH_REQUEST_LIMITS } from "./pubkyAuthRequestLimits";

export type PubkyAuthUrlValidationErrorCode =
  | "missing_relay"
  | "invalid_relay"
  | "invalid_callback";

export type PubkyAuthUrlValidationError = {
  code: PubkyAuthUrlValidationErrorCode;
  message: string;
};

export type PubkyAuthUrlValidationResult = ResultType<{
  callbacks: ValidatedPubkyAuthCallbacks;
  relayHost: string;
  relayOrigin: string;
}, PubkyAuthUrlValidationError>;

const UNSAFE_CALLBACK_PROTOCOLS = new Set([
  "javascript:",
  "data:",
  "file:",
  "blob:",
]);

type UrlParseResult = ResultType<URL, "invalid_url">;

export function validatePubkyAuthUrls(
  authUrl: URL,
): PubkyAuthUrlValidationResult {
  const relay = validateRelayUrl(
    authUrl.searchParams.get("relay"),
  );
  if (Result.isError(relay)) {
    return Result.err(relay.error);
  }

  const callbacks = validateCallbacks(authUrl);
  if (Result.isError(callbacks)) {
    return Result.err(callbacks.error);
  }

  return Result.ok({
    callbacks: callbacks.value,
    relayHost: relay.value.host,
    relayOrigin: relay.value.origin,
  });
}

export function validateRelayUrl(
  value: string | null,
): ResultType<URL, PubkyAuthUrlValidationError> {
  if (!value) {
    return error("missing_relay", "Pubky auth request is missing relay.");
  }

  if (value.length > PUBKY_AUTH_REQUEST_LIMITS.relayUrlLength) {
    return error("invalid_relay", "Pubky auth request relay is not an allowed URL.");
  }

  const parsed = parseAbsoluteUrl(value);
  if (
    Result.isError(parsed) ||
    parsed.value.protocol !== "https:" ||
    parsed.value.username !== "" ||
    parsed.value.password !== "" ||
    parsed.value.hash !== "" ||
    !isExactRelayHostname(parsed.value.hostname)
  ) {
    return error("invalid_relay", "Pubky auth request relay is not an allowed URL.");
  }

  return Result.ok(parsed.value);
}

function isExactRelayHostname(hostname: string): boolean {
  if (/^\[[0-9a-f:.]+\]$/i.test(hostname)) return true;

  const normalized = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  if (normalized.length === 0 || normalized.length > 253) return false;

  return normalized.split(".").every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)
  );
}

function validateCallbacks(
  authUrl: URL,
): ResultType<ValidatedPubkyAuthCallbacks, PubkyAuthUrlValidationError> {
  const rawSuccess = rawQueryValue(authUrl, "x-success");
  const success = validateOptionalCallback(decodeCallbackValue(
    rawSuccess ?? rawQueryValue(authUrl, "callback"),
  ));
  if (Result.isError(success)) {
    return Result.err(success.error);
  }

  const errorCallback = validateOptionalCallback(decodeCallbackValue(
    rawQueryValue(authUrl, "x-error"),
  ));
  if (Result.isError(errorCallback)) {
    return Result.err(errorCallback.error);
  }

  const cancel = validateOptionalCallback(decodeCallbackValue(
    rawQueryValue(authUrl, "x-cancel"),
  ));
  if (Result.isError(cancel)) {
    return Result.err(cancel.error);
  }

  const callbacks: ValidatedPubkyAuthCallbacks = {};
  if (success.value) {
    callbacks.success = success.value.href;
  }

  if (errorCallback.value) {
    callbacks.error = errorCallback.value.href;
  }

  if (cancel.value) {
    callbacks.cancel = cancel.value.href;
  }

  const callbackOrigins = new Set(
    [success.value, errorCallback.value, cancel.value]
      .filter((callback): callback is URL => callback !== undefined)
      .map((callback) => callback.origin),
  );
  if (callbackOrigins.size > 1) {
    return error("invalid_callback", "Pubky auth request callbacks must share one origin.");
  }

  return Result.ok(callbacks);
}

function rawQueryValue(url: URL, key: string): string | undefined {
  const query = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    const pairKey = separator === -1 ? pair : pair.slice(0, separator);
    if (pairKey === key) return separator === -1 ? "" : pair.slice(separator + 1);
  }
  return undefined;
}

function decodeCallbackValue(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!hasValidPercentTriplets(value)) return value;
  try {
    // Pubky v0.10 callback values use encodeURIComponent semantics: decode once
    // without converting a literal plus sign into a space.
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hasValidPercentTriplets(value: string): boolean {
  for (let index = value.indexOf("%"); index !== -1; index = value.indexOf("%", index + 3)) {
    if (!/^[A-Fa-f0-9]{2}$/u.test(value.slice(index + 1, index + 3))) return false;
  }
  return true;
}

export type ValidatedPubkyAuthCallbacks = {
  success?: string;
  error?: string;
  cancel?: string;
};

function validateOptionalCallback(
  value: string | null,
): ResultType<URL | undefined, PubkyAuthUrlValidationError> {
  if (!value) {
    return Result.ok(undefined);
  }

  if (value.length > PUBKY_AUTH_REQUEST_LIMITS.callbackUrlLength) {
    return error("invalid_callback", "Pubky auth request callback is not an allowed URL.");
  }

  const parsed = parseAbsoluteUrl(value);
  if (Result.isError(parsed) || !isAllowedCallbackUrl(parsed.value)) {
    return error("invalid_callback", "Pubky auth request callback is not an allowed URL.");
  }

  return Result.ok(parsed.value);
}

function isAllowedCallbackUrl(url: URL): boolean {
  if (UNSAFE_CALLBACK_PROTOCOLS.has(url.protocol)) {
    return false;
  }

  return url.protocol === "https:";
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
