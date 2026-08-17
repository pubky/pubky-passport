import "client-only";

import { Result, type Result as ResultType } from "better-result";

import {
  parsePubkyAuthRequest,
  type PubkyAuthenticationMethod,
  type PubkyAuthParseError,
  type PubkyAuthRequestKind,
} from "./parsePubkyAuthRequest";

declare const pubkyAuthApprovalCapabilityBrand: unique symbol;

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

/** Exact-object browser capability required to approve a validated request. */
export type PubkyAuthApprovalCapability = Readonly<{
  readonly [pubkyAuthApprovalCapabilityBrand]: "PubkyAuthApprovalCapability";
}>;

export type BrowserAuthorizationRequest = Readonly<{
  review: AuthorizationRequestReview;
  approval: PubkyAuthApprovalCapability;
}>;

export type BrowserAuthorizationRequestResult = ResultType<BrowserAuthorizationRequest, PubkyAuthParseError>;

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
export function parseBrowserAuthorizationRequest(
  d: unknown,
): BrowserAuthorizationRequestResult {
  const parsed = parsePubkyAuthRequest(d);
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

/** Returns private callbacks only for an exact browser-issued approval object. */
export function getValidatedAuthorizationCallbacks(
  approval: PubkyAuthApprovalCapability,
): ValidatedAuthorizationCallbacks | undefined {
  return APPROVAL_METADATA.get(approval)?.callbacks;
}

/** Returns the sensitive URL only for an exact browser-issued approval object. */
export function getValidatedSensitivePubkyAuthUrl(
  approval: PubkyAuthApprovalCapability,
): string | undefined {
  return APPROVAL_METADATA.get(approval)?.sensitivePubkyAuthUrl;
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
