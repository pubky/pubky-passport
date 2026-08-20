import "client-only";

import { Result, type Result as ResultType } from "better-result";

import {
  parseEncodedPubkyAuthRequest,
  type ParsedPubkyAuthRequest,
  type PubkyAuthenticationMethod,
  type PubkyAuthParseError,
} from "./pubkyAuthRequestParser";
import type { ValidatedPubkyAuthCallbacks } from "./pubkyAuthUrls";

/** One safe capability row rendered during authorization review. */
export type AuthorizationCapability = Readonly<{
  path: string;
  read: boolean;
  write: boolean;
  scope: "specific" | "broad";
}>;

/** Safe, immutable request data that may enter React state and rendered output. */
export type AuthorizationRequestReview = Readonly<{
  authenticationMethod: PubkyAuthenticationMethod;
  capabilities: readonly AuthorizationCapability[];
  callbackHost?: string;
}>;

type ValidatedAuthorizationMetadata = Readonly<{
  callbacks: Readonly<ValidatedPubkyAuthCallbacks>;
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
    outcome: keyof ValidatedPubkyAuthCallbacks,
  ): string | undefined {
    try {
      return REQUEST_METADATA.get(request)?.callbacks[outcome];
    } catch {
      return undefined;
    } finally {
      REQUEST_METADATA.delete(request);
    }
  }

  /** Releases private metadata when the request expires or is abandoned. */
  static release(request: IssuedPubkyAuthRequest): void {
    REQUEST_METADATA.delete(request);
  }
}

function createAuthorizationReview(
  parsed: Pick<
    ParsedPubkyAuthRequest,
    "authenticationMethod" | "capabilities" | "callbacks"
  >,
): AuthorizationRequestReview {
  const capabilities = Object.freeze(parsed.capabilities.map((capability) => Object.freeze({
    ...capability,
    scope: getCapabilityScope(capability.path),
  })));
  const callbackHost = getCallbackHost(parsed.callbacks);

  return Object.freeze({
    authenticationMethod: parsed.authenticationMethod,
    capabilities,
    ...(callbackHost ? { callbackHost } : {}),
  });
}

function getCapabilityScope(path: string): AuthorizationCapability["scope"] {
  return path === "/" || path === "/pub/" || path === "/priv/"
    ? "broad"
    : "specific";
}

function getCallbackHost(
  callbacks: Readonly<ValidatedPubkyAuthCallbacks>,
): string | undefined {
  const displayCallback = callbacks.success ?? callbacks.error ?? callbacks.cancel;
  if (!displayCallback) return undefined;

  try {
    // URL.host preserves punycode and non-default ports without displaying userinfo.
    return new URL(displayCallback).host || undefined;
  } catch {
    return undefined;
  }
}
