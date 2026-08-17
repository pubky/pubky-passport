import "client-only";

import { Result, type Result as ResultType } from "better-result";

import {
  parseEncodedPubkyAuthRequest,
  type PubkyAuthenticationMethod,
  type PubkyAuthParseError,
  type PubkyAuthRequestKind,
} from "./pubkyAuthRequestParser";
import type { AuthorizationOutcome } from "./authorizationOutcomeHandoff";

/** One safe capability row rendered during authorization review. */
export type AuthorizationCapability = Readonly<{
  path: string;
  read: boolean;
  write: boolean;
  scope: "specific" | "broad";
}>;

/** Safe, immutable request data that may enter React state and rendered output. */
export type AuthorizationRequestReview = Readonly<{
  kind: PubkyAuthRequestKind;
  authenticationMethod: PubkyAuthenticationMethod;
  capabilities: readonly AuthorizationCapability[];
  callbackAvailability: Readonly<{
    success: boolean;
    error: boolean;
    cancel: boolean;
  }>;
  relayHost: string;
  requestingAppDisplayHost: string;
}>;

type ValidatedAuthorizationCallbacks = Readonly<{
  success?: string;
  error?: string;
  cancel?: string;
}>;

type ValidatedAuthorizationMetadata = Readonly<{
  callbacks: ValidatedAuthorizationCallbacks;
  sensitivePubkyAuthUrl: string;
}>;

export type IssuePubkyAuthRequestResult = ResultType<
  IssuedPubkyAuthRequest,
  PubkyAuthParseError
>;

export type ValidatePubkyAuthRequestResult = ResultType<void, PubkyAuthParseError>;

// Sensitive details are available only through the exact issued instance and are
// automatically discarded when that instance is no longer reachable.
const REQUEST_METADATA = new WeakMap<IssuedPubkyAuthRequest, ValidatedAuthorizationMetadata>();

/**
 * A validated Pubky Auth request and the authority to approve that exact request.
 * Only the safe `review` property may be exposed to UI state.
 */
export class IssuedPubkyAuthRequest {
  private constructor(
    readonly review: AuthorizationRequestReview,
  ) {}

  /** Validates and issues one exact request for review and later approval. */
  static issue(encodedRequest: unknown): IssuePubkyAuthRequestResult {
    const parsed = parseEncodedPubkyAuthRequest(encodedRequest);
    if (Result.isError(parsed)) return Result.err(parsed.error);

    const review = createAuthorizationReview(parsed.value);
    const request = new IssuedPubkyAuthRequest(review);
    REQUEST_METADATA.set(request, Object.freeze({
      callbacks: parsed.value.callbacks,
      sensitivePubkyAuthUrl: parsed.value.sensitivePubkyAuthUrl,
    }));

    return Result.ok(Object.freeze(request));
  }

  /** Validates manual input without issuing approval authority. */
  static validate(encodedRequest: unknown): ValidatePubkyAuthRequestResult {
    const parsed = parseEncodedPubkyAuthRequest(encodedRequest);
    return Result.isError(parsed) ? Result.err(parsed.error) : Result.ok();
  }

  /** Returns whether a value is the exact live request issued by this class. */
  static isLive(value: unknown): value is IssuedPubkyAuthRequest {
    return typeof value === "object"
      && value !== null
      && REQUEST_METADATA.has(value as IssuedPubkyAuthRequest);
  }

  /** Returns the validated URL only while this exact request remains live. */
  static validatedUrlForApproval(request: IssuedPubkyAuthRequest): string | undefined {
    return REQUEST_METADATA.get(request)?.sensitivePubkyAuthUrl;
  }

  /** Takes one validated callback and releases all remaining private metadata. */
  static takeOutcomeCallback(
    request: IssuedPubkyAuthRequest,
    outcome: AuthorizationOutcome,
  ): string | undefined {
    const callback = REQUEST_METADATA.get(request)?.callbacks[outcome];
    REQUEST_METADATA.delete(request);
    return callback;
  }

  /** Releases private metadata when the request expires or is abandoned. */
  static release(request: IssuedPubkyAuthRequest): void {
    REQUEST_METADATA.delete(request);
  }
}

function createAuthorizationReview(parsed: {
  kind: PubkyAuthRequestKind;
  authenticationMethod: PubkyAuthenticationMethod;
  capabilities: Array<{ path: string; read: boolean; write: boolean }>;
  callbacks: ValidatedAuthorizationCallbacks;
  relayHost: string;
}): AuthorizationRequestReview {
  const capabilities = Object.freeze(parsed.capabilities.map((capability) => Object.freeze({
    ...capability,
    scope: getCapabilityScope(capability.path),
  })));
  const callbackAvailability = Object.freeze({
    success: parsed.callbacks.success !== undefined,
    error: parsed.callbacks.error !== undefined,
    cancel: parsed.callbacks.cancel !== undefined,
  });

  return Object.freeze({
    kind: parsed.kind,
    authenticationMethod: parsed.authenticationMethod,
    capabilities,
    callbackAvailability,
    relayHost: parsed.relayHost,
    requestingAppDisplayHost: getRequestingAppDisplayHost(
      parsed.callbacks,
      parsed.relayHost,
    ),
  });
}

function getCapabilityScope(path: string): AuthorizationCapability["scope"] {
  return path === "/" || path === "/pub" || path === "/pub/" ? "broad" : "specific";
}

function getRequestingAppDisplayHost(
  callbacks: ValidatedAuthorizationCallbacks,
  relayHost: string,
): string {
  const displayCallback = callbacks.success ?? callbacks.error ?? callbacks.cancel;
  if (!displayCallback) return relayHost;

  try {
    // URL.hostname preserves punycode, avoiding Unicode homograph display.
    return new URL(displayCallback).hostname || relayHost;
  } catch {
    return relayHost;
  }
}
