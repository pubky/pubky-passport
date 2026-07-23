import { Result, type Err, type Result as ResultType } from "better-result";

import {
  parsePubkyAuthCapabilities,
  type PubkyAuthCapability,
  type PubkyAuthCapabilitiesParseError,
} from "./parsePubkyAuthCapabilities";
import {
  validatePubkyAuthUrls,
  type PubkyAuthCallbackAvailability,
  type ValidatedPubkyAuthCallbacks as ValidatedPubkyAuthCallbacksInternal,
  type PubkyAuthUrlValidationError,
  type PubkyAuthUrlValidationOptions,
} from "./validatePubkyAuthUrls";
import {
  pubkyAuthRequestParameters,
} from "./pubkyAuthRequestParameters";
import { pubkyAuthRequestLimits } from "./pubkyAuthRequestLimits";

export type { PubkyAuthCapability } from "./parsePubkyAuthCapabilities";
export type { PubkyAuthCallbackAvailability } from "./validatePubkyAuthUrls";

export type PubkyAuthRequestKind = "signin";

declare const validatedSensitivePubkyAuthRequestBrand: unique symbol;
const parserIssuedApprovalRequests = new WeakSet<object>();
const parserIssuedApprovalCallbacks = new WeakMap<object, Readonly<ValidatedPubkyAuthCallbacksInternal>>();

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
  | PubkyAuthUrlValidationError["code"];

export type PubkyAuthParseError = {
  code: PubkyAuthParseErrorCode;
  message: string;
};

export type PubkyAuthRequestReview = {
  kind: PubkyAuthRequestKind;
  capabilities: PubkyAuthCapability[];
  callbackAvailability: PubkyAuthCallbackAvailability;
  requestingAppDisplayName?: string;
};

export type ValidatedSensitivePubkyAuthRequest = {
  readonly sensitivePubkyAuthUrl: string & {
    readonly [validatedSensitivePubkyAuthRequestBrand]: "ValidatedSensitivePubkyAuthRequest";
  };
};

export type ValidatedPubkyAuthCallbacks = Readonly<{
  success?: string;
  error?: string;
  cancel?: string;
}>;

export type ValidatedPubkyAuthRequest = {
  review: PubkyAuthRequestReview;
  approval: ValidatedSensitivePubkyAuthRequest;
};

export type PubkyAuthParseResult = ResultType<ValidatedPubkyAuthRequest, PubkyAuthParseError>;

type ParseValueResult<T> = ResultType<T, PubkyAuthParseError>;

export type ParsePubkyAuthRequestOptions = PubkyAuthUrlValidationOptions;

const PUBKY_AUTH_PROTOCOL = "pubkyauth:";

export function parsePubkyAuthRequest(
  d: unknown,
  options: ParsePubkyAuthRequestOptions = { allowedRelayOrigins: [] },
): PubkyAuthParseResult {
  if (typeof d !== "string" || d.length === 0) {
    return error("missing_d", "Missing encoded Pubky auth request.");
  }

  if (d.length > pubkyAuthRequestLimits.encodedDLength) {
    return error("request_too_large", "Encoded Pubky auth request exceeds the allowed size.");
  }

  const decoded = decodeDParam(d);
  if (Result.isError(decoded)) {
    return Result.err(decoded.error);
  }

  if (decoded.value.length > pubkyAuthRequestLimits.decodedAuthUrlLength) {
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

  const secret = authUrl.value.searchParams.get(pubkyAuthRequestParameters.secret);
  if (!secret) {
    return error("missing_secret", "Pubky auth request is missing a secret.");
  }

  if (secret.length > pubkyAuthRequestLimits.secretLength) {
    return error("invalid_secret", "Pubky auth request secret exceeds the allowed size.");
  }

  const urls = validatePubkyAuthUrls(authUrl.value, options);
  if (Result.isError(urls)) {
    return mapUrlValidationError(urls.error);
  }

  const capabilities = parsePubkyAuthCapabilities(authUrl.value.searchParams.get(pubkyAuthRequestParameters.capabilities));
  if (Result.isError(capabilities)) {
    return mapCapabilitiesError(capabilities.error);
  }

  const review: PubkyAuthRequestReview = {
    kind: kind.value,
    capabilities: capabilities.value,
    callbackAvailability: urls.value.callbackAvailability,
  };

  if (urls.value.requestingAppDisplayName) {
    review.requestingAppDisplayName = urls.value.requestingAppDisplayName;
  }

  const approval: ValidatedSensitivePubkyAuthRequest = Object.freeze({
    sensitivePubkyAuthUrl: authUrl.value.href as ValidatedSensitivePubkyAuthRequest["sensitivePubkyAuthUrl"],
  });
  parserIssuedApprovalRequests.add(approval);
  parserIssuedApprovalCallbacks.set(approval, Object.freeze({ ...urls.value.callbacks }));

  return Result.ok({ review, approval });
}

export function isParserIssuedPubkyAuthRequest(
  value: unknown,
): value is ValidatedSensitivePubkyAuthRequest {
  return typeof value === "object" && value !== null && parserIssuedApprovalRequests.has(value);
}

export function getParserIssuedPubkyAuthCallbacks(
  approval: ValidatedSensitivePubkyAuthRequest,
): ValidatedPubkyAuthCallbacks | undefined {
  return parserIssuedApprovalCallbacks.get(approval);
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


function error(
  code: PubkyAuthParseErrorCode,
  message: string,
): Err<never, PubkyAuthParseError> {
  return Result.err<never, PubkyAuthParseError>({ code, message });
}
