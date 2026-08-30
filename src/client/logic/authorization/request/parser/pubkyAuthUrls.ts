import "client-only";

import { Result, type Result as ResultType } from "better-result";

/** Bounds enforced while validating authorization relay and callback URLs. */
export const PUBKY_AUTH_URL_LIMITS = {
  maximumRelayUrlCodeUnits: 2_048,
  maximumCallbackUrlCodeUnits: 2_048,
} as const;

type PubkyAuthUrlValidationErrorCode = "missing_relay" | "invalid_relay" | "invalid_callback";

export type PubkyAuthUrlValidationError = {
  code: PubkyAuthUrlValidationErrorCode;
};

/** Canonical callbacks retained outside renderable authorization state. */
export type ValidatedPubkyAuthCallbacks = {
  success?: string;
  error?: string;
  cancel?: string;
};

type PubkyAuthUrlValidationResult = ResultType<
  ValidatedPubkyAuthCallbacks,
  PubkyAuthUrlValidationError
>;

const URL_PARAMETERS = {
  relay: "relay",
  success: "x-success",
  error: "x-error",
  cancel: "x-cancel",
  legacySuccess: "callback",
} as const;

/** Validates bounded relay and callback URLs before review or signing is possible. */
export function validatePubkyAuthUrls(authUrl: URL): PubkyAuthUrlValidationResult {
  const relay = validateRelayUrl(authUrl.searchParams.get(URL_PARAMETERS.relay));
  if (Result.isError(relay)) {
    return Result.err(relay.error);
  }

  return validateCallbacks(authUrl);
}

/** Validates one exact CSP-safe HTTPS relay URL. */
function validateRelayUrl(value: string | null): ResultType<void, PubkyAuthUrlValidationError> {
  if (!value) {
    return Result.err<never, PubkyAuthUrlValidationError>({ code: "missing_relay" });
  }

  if (value.length > PUBKY_AUTH_URL_LIMITS.maximumRelayUrlCodeUnits) {
    return Result.err<never, PubkyAuthUrlValidationError>({ code: "invalid_relay" });
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
    return Result.err<never, PubkyAuthUrlValidationError>({ code: "invalid_relay" });
  }

  return Result.ok();
}

function isExactRelayHostname(hostname: string): boolean {
  if (/^\[[0-9a-f:.]+\]$/i.test(hostname)) return true;

  const normalized = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  if (normalized.length === 0 || normalized.length > 253) return false;

  return normalized
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function validateCallbacks(
  authUrl: URL,
): ResultType<ValidatedPubkyAuthCallbacks, PubkyAuthUrlValidationError> {
  const rawSuccess = rawQueryValue(authUrl, URL_PARAMETERS.success);
  const success = validateEncodedCallback(
    rawSuccess ?? rawQueryValue(authUrl, URL_PARAMETERS.legacySuccess),
  );
  if (Result.isError(success)) {
    return Result.err(success.error);
  }

  const errorCallback = validateEncodedCallback(rawQueryValue(authUrl, URL_PARAMETERS.error));
  if (Result.isError(errorCallback)) {
    return Result.err(errorCallback.error);
  }

  const cancel = validateEncodedCallback(rawQueryValue(authUrl, URL_PARAMETERS.cancel));
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
    return Result.err<never, PubkyAuthUrlValidationError>({ code: "invalid_callback" });
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
    return Result.err<never, PubkyAuthUrlValidationError>({ code: "invalid_callback" });
  }
}

function validateOptionalCallback(
  value: string | null,
): ResultType<URL | undefined, PubkyAuthUrlValidationError> {
  if (!value) {
    return Result.ok(undefined);
  }

  if (value.length > PUBKY_AUTH_URL_LIMITS.maximumCallbackUrlCodeUnits) {
    return Result.err<never, PubkyAuthUrlValidationError>({ code: "invalid_callback" });
  }

  const parsed = parseAbsoluteUrl(value);
  if (parsed === null || parsed.protocol !== "https:") {
    return Result.err<never, PubkyAuthUrlValidationError>({ code: "invalid_callback" });
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
