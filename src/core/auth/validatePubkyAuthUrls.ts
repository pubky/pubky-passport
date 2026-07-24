import { Result, type Err, type Result as ResultType } from "better-result";

import {
  pubkyAuthRequestParameters,
  validatePubkyAuthRequestParameters,
  type PubkyAuthRequestParameterErrorCode,
} from "./pubkyAuthRequestParameters";
import { pubkyAuthRequestLimits } from "./pubkyAuthRequestLimits";

export type PubkyAuthCallbackAvailability = {
  success: boolean;
  error: boolean;
  cancel: boolean;
};

export type PubkyAuthUrlValidationErrorCode =
  | "missing_relay"
  | "invalid_relay"
  | "invalid_callback"
  | PubkyAuthRequestParameterErrorCode;

export type PubkyAuthUrlValidationError = {
  code: PubkyAuthUrlValidationErrorCode;
  message: string;
};

export type PubkyAuthUrlValidationResult = ResultType<{
  callbackAvailability: PubkyAuthCallbackAvailability;
  callbacks: ValidatedPubkyAuthCallbacks;
  relayHost: string;
  relayOrigin: string;
  requestingAppDisplayName?: string;
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
  const parameters = validatePubkyAuthRequestParameters(authUrl.searchParams);
  if (Result.isError(parameters)) {
    return Result.err(parameters.error);
  }

  const relay = validateRelayUrl(
    authUrl.searchParams.get(pubkyAuthRequestParameters.relay),
  );
  if (Result.isError(relay)) {
    return Result.err(relay.error);
  }

  const callbacks = validateCallbacks(authUrl);
  if (Result.isError(callbacks)) {
    return Result.err(callbacks.error);
  }

  const requestingAppDisplayName = deriveDisplayDomain(callbacks.value);

  return Result.ok({
    callbacks: callbacks.value,
    relayHost: relay.value.host,
    relayOrigin: relay.value.origin,
    callbackAvailability: {
      success: callbacks.value.success !== undefined,
      error: callbacks.value.error !== undefined,
      cancel: callbacks.value.cancel !== undefined,
    },
    ...(requestingAppDisplayName ? { requestingAppDisplayName } : {}),
  });
}

export function validateRelayUrl(
  value: string | null,
): ResultType<URL, PubkyAuthUrlValidationError> {
  if (!value) {
    return error("missing_relay", "Pubky auth request is missing relay.");
  }

  if (value.length > pubkyAuthRequestLimits.relayUrlLength) {
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

function deriveDisplayDomain(callbacks: ValidatedPubkyAuthCallbacks): string | undefined {
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
): ResultType<ValidatedPubkyAuthCallbacks, PubkyAuthUrlValidationError> {
  const success = validateOptionalCallback(authUrl.searchParams.get(pubkyAuthRequestParameters.success));
  if (Result.isError(success)) {
    return Result.err(success.error);
  }

  const errorCallback = validateOptionalCallback(authUrl.searchParams.get(pubkyAuthRequestParameters.error));
  if (Result.isError(errorCallback)) {
    return Result.err(errorCallback.error);
  }

  const cancel = validateOptionalCallback(authUrl.searchParams.get(pubkyAuthRequestParameters.cancel));
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

  if (value.length > pubkyAuthRequestLimits.callbackUrlLength) {
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
