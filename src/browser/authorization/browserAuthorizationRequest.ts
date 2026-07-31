import "client-only";

import { Result, type Result as ResultType } from "better-result";

import {
  parsePubkyAuthRequest,
  type PubkyAuthParseError,
  type PubkyAuthRequestKind,
} from "../../core/auth/parsePubkyAuthRequest";
import type { PubkyAuthCapability } from "../../core/auth/parsePubkyAuthCapabilities";

declare const pubkyAuthApprovalCapabilityBrand: unique symbol;

const VALIDATED_APPROVALS = new WeakSet<object>();
const APPROVAL_CALLBACKS = new WeakMap<object, ValidatedAuthorizationCallbacks>();

export type AuthorizationCapability = Readonly<PubkyAuthCapability & {
  scope: "specific" | "broad";
}>;

export type AuthorizationRequestReview = Readonly<{
  kind: PubkyAuthRequestKind;
  capabilities: readonly AuthorizationCapability[];
  callbackAvailability: Readonly<{
    success: boolean;
    error: boolean;
    cancel: boolean;
  }>;
  relayHost: string;
  requestingAppDisplayHost?: string;
}>;

export type PubkyAuthApprovalCapability = Readonly<{
  sensitivePubkyAuthUrl: string & {
    readonly [pubkyAuthApprovalCapabilityBrand]: "PubkyAuthApprovalCapability";
  };
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

export function parseBrowserAuthorizationRequest(d: unknown): BrowserAuthorizationRequestResult {
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
  const requestingAppDisplayHost = getRequestingAppDisplayHost(parsed.value.callbacks);
  const review: AuthorizationRequestReview = Object.freeze({
    kind: parsed.value.kind,
    capabilities,
    callbackAvailability,
    relayHost: parsed.value.relayHost,
    ...(requestingAppDisplayHost ? { requestingAppDisplayHost } : {}),
  });
  const approval: PubkyAuthApprovalCapability = Object.freeze({
    sensitivePubkyAuthUrl: parsed.value.sensitivePubkyAuthUrl as PubkyAuthApprovalCapability["sensitivePubkyAuthUrl"],
  });

  VALIDATED_APPROVALS.add(approval);
  APPROVAL_CALLBACKS.set(approval, parsed.value.callbacks);

  return Result.ok(Object.freeze({ review, approval }));
}

export function isPubkyAuthApprovalCapability(value: unknown): value is PubkyAuthApprovalCapability {
  return typeof value === "object" && value !== null && VALIDATED_APPROVALS.has(value);
}

export function getValidatedAuthorizationCallbacks(
  approval: PubkyAuthApprovalCapability,
): ValidatedAuthorizationCallbacks | undefined {
  return APPROVAL_CALLBACKS.get(approval);
}

function getCapabilityScope(path: string): AuthorizationCapability["scope"] {
  return path === "/" || path === "/pub" || path === "/pub/" ? "broad" : "specific";
}

function getRequestingAppDisplayHost(callbacks: ValidatedAuthorizationCallbacks): string | undefined {
  const displayCallback = callbacks.success ?? callbacks.error ?? callbacks.cancel;
  if (!displayCallback) return undefined;

  try {
    // URL.hostname preserves punycode, avoiding Unicode homograph display.
    return new URL(displayCallback).hostname || undefined;
  } catch {
    return undefined;
  }
}
