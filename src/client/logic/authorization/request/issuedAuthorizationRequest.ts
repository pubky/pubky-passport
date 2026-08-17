import "client-only";

import { Result, type Result as ResultType } from "better-result";

import {
  parseEncodedPubkyAuthRequest,
  type PubkyAuthenticationMethod,
  type PubkyAuthParseError,
  type PubkyAuthRequestKind,
} from "./parseEncodedPubkyAuthRequest";

declare const pubkyAuthApprovalCapabilityBrand: unique symbol;

// Sensitive details are available only through the exact approval object and are
// automatically discarded when that object is no longer reachable.
const APPROVAL_METADATA = new WeakMap<object, ValidatedAuthorizationMetadata>();

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

/** Exact-object capability required to approve a validated request. */
export type PubkyAuthApprovalCapability = Readonly<{
  readonly [pubkyAuthApprovalCapabilityBrand]: "PubkyAuthApprovalCapability";
}>;

export type IssuedAuthorizationRequest = Readonly<{
  review: AuthorizationRequestReview;
  approval: PubkyAuthApprovalCapability;
}>;

export type IssueAuthorizationRequestResult = ResultType<IssuedAuthorizationRequest, PubkyAuthParseError>;
export type AuthorizationOutcome = "success" | "error" | "cancel";

type ValidatedAuthorizationCallbacks = Readonly<{
  success?: string;
  error?: string;
  cancel?: string;
}>;

type ValidatedAuthorizationMetadata = Readonly<{
  callbacks: ValidatedAuthorizationCallbacks;
  sensitivePubkyAuthUrl: string;
}>;

/**
 * Parses one encoded request into safe review data and an unforgeable approval
 * capability. The sensitive URL and callbacks remain in exact-object metadata.
 */
export function issueAuthorizationRequest(
  encodedRequest: unknown,
): IssueAuthorizationRequestResult {
  const parsed = parseEncodedPubkyAuthRequest(encodedRequest);
  if (Result.isError(parsed)) return Result.err(parsed.error);

  const capabilities = Object.freeze(parsed.value.capabilities.map((capability) => Object.freeze({
    ...capability,
    scope: getCapabilityScope(capability.path),
  })));
  const callbackAvailability = Object.freeze({
    success: parsed.value.callbacks.success !== undefined,
    error: parsed.value.callbacks.error !== undefined,
    cancel: parsed.value.callbacks.cancel !== undefined,
  });
  const review: AuthorizationRequestReview = Object.freeze({
    kind: parsed.value.kind,
    authenticationMethod: parsed.value.authenticationMethod,
    capabilities,
    callbackAvailability,
    relayHost: parsed.value.relayHost,
    requestingAppDisplayHost: getRequestingAppDisplayHost(
      parsed.value.callbacks,
      parsed.value.relayHost,
    ),
  });
  const approval = Object.freeze({}) as PubkyAuthApprovalCapability;

  APPROVAL_METADATA.set(approval, Object.freeze({
    callbacks: parsed.value.callbacks,
    sensitivePubkyAuthUrl: parsed.value.sensitivePubkyAuthUrl,
  }));

  return Result.ok(Object.freeze({ review, approval }));
}

/** Returns whether a value is the exact approval object issued by this module. */
export function isPubkyAuthApprovalCapability(value: unknown): value is PubkyAuthApprovalCapability {
  return typeof value === "object" && value !== null && APPROVAL_METADATA.has(value);
}

/** Returns one exact validated callback without exposing the complete callback set. */
export function getValidatedOutcomeCallback(
  approval: PubkyAuthApprovalCapability,
  outcome: AuthorizationOutcome,
): string | undefined {
  return APPROVAL_METADATA.get(approval)?.callbacks[outcome];
}

/** Returns the sensitive URL only for the exact issued approval object. */
export function getValidatedSensitivePubkyAuthUrl(
  approval: PubkyAuthApprovalCapability,
): string | undefined {
  return APPROVAL_METADATA.get(approval)?.sensitivePubkyAuthUrl;
}

/** Releases all private metadata once approval and callback handling are terminal. */
export function releaseAuthorizationApproval(
  approval: PubkyAuthApprovalCapability,
): void {
  APPROVAL_METADATA.delete(approval);
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
