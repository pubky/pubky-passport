import "client-only";

import { Result, type Err, type Result as ResultType } from "better-result";

import { PUBKY_AUTH_REQUEST_LIMITS } from "./pubkyAuthRequestLimits";

export type PubkyAuthUrlValidationErrorCode =
  | "missing_relay"
  | "invalid_relay"
  | "invalid_callback";

export type PubkyAuthUrlValidationError = {
  code: PubkyAuthUrlValidationErrorCode;
};

export type PubkyAuthUrlValidationResult = ResultType<
  ValidatedPubkyAuthCallbacks,
  PubkyAuthUrlValidationError
>;

export type PubkyAuthUrlParameterNames = Readonly<{
  relay: string;
  success: string;
  error: string;
  cancel: string;
  legacySuccess: string;
}>;

/** Validates the relay and callback URLs before review or signing is possible. */
export function validatePubkyAuthUrls(
  authUrl: URL,
  parameterNames: PubkyAuthUrlParameterNames,
): PubkyAuthUrlValidationResult {
  const relay = validateRelayUrl(
    authUrl.searchParams.get(parameterNames.relay),
  );
  if (Result.isError(relay)) {
    return Result.err(relay.error);
  }

  return validateCallbacks(authUrl, parameterNames);
}

/** Validates one exact CSP-safe HTTPS relay URL. */
function validateRelayUrl(
  value: string | null,
): ResultType<void, PubkyAuthUrlValidationError> {
  if (!value) {
    return error("missing_relay");
  }

  if (value.length > PUBKY_AUTH_REQUEST_LIMITS.maximumRelayUrlCodeUnits) {
    return error("invalid_relay");
  }

  const parsed = parseAbsoluteUrl(value);
  if (
    parsed === null ||
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    parsed.port !== "" ||
    !isExactRelayHostname(parsed.hostname)
  ) {
    return error("invalid_relay");
  }

  return Result.ok();
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
  parameterNames: PubkyAuthUrlParameterNames,
): ResultType<ValidatedPubkyAuthCallbacks, PubkyAuthUrlValidationError> {
  const rawSuccess = rawQueryValue(authUrl, parameterNames.success);
  const success = validateEncodedCallback(
    rawSuccess ?? rawQueryValue(authUrl, parameterNames.legacySuccess),
  );
  if (Result.isError(success)) {
    return Result.err(success.error);
  }

  const errorCallback = validateEncodedCallback(
    rawQueryValue(authUrl, parameterNames.error),
  );
  if (Result.isError(errorCallback)) {
    return Result.err(errorCallback.error);
  }

  const cancel = validateEncodedCallback(
    rawQueryValue(authUrl, parameterNames.cancel),
  );
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
    return error("invalid_callback");
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

function validateEncodedCallback(
  value: string | undefined,
): ResultType<URL | undefined, PubkyAuthUrlValidationError> {
  if (value === undefined) return Result.ok(undefined);

  try {
    // Pubky v0.10 callback values use encodeURIComponent semantics: decode once
    // without converting a literal plus sign into a space.
    return validateOptionalCallback(decodeURIComponent(value));
  } catch {
    return error("invalid_callback");
  }
}

/** Canonical callbacks retained outside renderable authorization state. */
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

  if (value.length > PUBKY_AUTH_REQUEST_LIMITS.maximumCallbackUrlCodeUnits) {
    return error("invalid_callback");
  }

  const parsed = parseAbsoluteUrl(value);
  if (parsed === null || parsed.protocol !== "https:") {
    return error("invalid_callback");
  }

  return Result.ok(parsed);
}

function parseAbsoluteUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function error(
  code: PubkyAuthUrlValidationErrorCode,
): Err<never, PubkyAuthUrlValidationError> {
  return Result.err<never, PubkyAuthUrlValidationError>({ code });
}
