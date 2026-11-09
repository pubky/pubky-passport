const PREFIX = "pubky-passport.";
const ATTEMPT_ID = /^[A-Za-z0-9_-]{16,64}$/u;
const CODE = /^[a-z_]{1,64}$/u;
const MAX_FEATURES = 16;
const FEATURE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
/** Passport's `ready` feature: it accepts `profile-needed` and answers `profile-ready`. */
export const PROFILE_SETUP_FEATURE = "profile-setup";
/**
 * Sent in the hello while the app offers a keychain route of its own (the large element's code
 * or its "Open keychain app" button): Passport then leaves the keychain out of a request's Sign in.
 * A display hint only; it grants nothing.
 */
export const KEYCHAIN_FEATURE = "keychain";

// Kept exhaustive against Passport's types by the repository-level drift test.
export const REQUEST_CODES = [
  "missing_d",
  "request_too_large",
  "invalid_encoding",
  "invalid_url",
  "unsupported_scheme",
  "invalid_auth_request_path",
  "missing_secret",
  "invalid_secret",
  "invalid_source",
  "missing_client_id",
  "invalid_client_id",
  "missing_client_public_key",
  "invalid_client_public_key",
  "missing_capabilities",
  "invalid_capability",
  "duplicate_parameter",
  "unsupported_parameter",
  "missing_relay",
  "invalid_relay",
  "invalid_callback",
  "invalid_fragment_shape",
  "invalid_search",
  "too_large",
  "history_unavailable",
  "network_mismatch",
] as const;
export const APPROVAL_CODES = [
  "storage_unavailable",
  "identity_unavailable",
  "relay_unreachable",
  "approval_failed",
] as const;
type RequestStatus = "valid" | "invalid" | "empty" | "expired" | "completed";
type RequestCode = (typeof REQUEST_CODES)[number];
type ApprovalCode = (typeof APPROVAL_CODES)[number];
type Outcome = "success" | "cancel" | "error";
type Version = { readonly version: 1 } | { readonly version: 2; readonly attemptId: string };
export type PassportMessage =
  | Readonly<{
      type: "pubky-passport.ready";
      version: 2;
      attemptId: string;
      protocols: readonly [1, 2];
      features: readonly string[];
      request: Readonly<{ status: RequestStatus; code?: RequestCode }>;
    }>
  | Readonly<{
      type: "pubky-passport.status";
      version: 2;
      attemptId: string;
      phase: "ring" | "granting";
    }>
  /** Passport published the profile this attempt asked for with `profile-needed`. */
  | Readonly<{ type: "pubky-passport.profile-ready"; version: 2; attemptId: string }>
  | (Version &
      Readonly<{
        type: "pubky-passport.authorization-outcome";
        messageId: string;
        outcome: Outcome;
        code?: ApprovalCode;
      }>);

function plain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isPassportMessage(value: unknown): boolean {
  try {
    if (typeof value !== "object" || value === null) return false;
    const type: unknown = (value as Record<string, unknown>).type;
    return typeof type === "string" && type.startsWith(PREFIX);
  } catch {
    return false;
  }
}

/** The caller checks the event's origin and source before parsing its untrusted data. */
export function parsePassportMessage(value: unknown): PassportMessage | undefined {
  try {
    if (!plain(value)) return;
    const { type, version } = value;
    let header: Version;
    if (version === 2) {
      const attemptId = value.attemptId;
      if (typeof attemptId !== "string" || !ATTEMPT_ID.test(attemptId)) return;
      header = { version, attemptId };
    } else if (version === 1) header = { version };
    else return;
    if (type === "pubky-passport.authorization-outcome") {
      const { messageId, outcome, code } = value;
      if (
        typeof messageId !== "string" ||
        messageId.length < 1 ||
        messageId.length > 128 ||
        (outcome !== "success" && outcome !== "error" && outcome !== "cancel") ||
        !validCode(code)
      )
        return;
      const known = outcome === "error" ? knownCode(code, APPROVAL_CODES) : undefined;
      return Object.freeze({
        type,
        ...header,
        messageId,
        outcome,
        ...(known ? { code: known } : {}),
      });
    }
    if (header.version !== 2) return;
    if (type === "pubky-passport.profile-ready") return Object.freeze({ type, ...header });
    if (type === "pubky-passport.status") {
      const phase = value.phase;
      if (phase !== "ring" && phase !== "granting") return;
      return Object.freeze({ type, ...header, phase });
    }
    if (type !== "pubky-passport.ready") return;
    const { protocols, features, request } = value;
    if (
      !Array.isArray(protocols) ||
      protocols.length !== 2 ||
      protocols[0] !== 1 ||
      protocols[1] !== 2 ||
      !plain(request) ||
      !Array.isArray(features)
    )
      return;
    const copiedFeatures: string[] = [];
    const length = features.length;
    if (!Number.isInteger(length) || length < 0 || length > MAX_FEATURES) return;
    for (let i = 0; i < length; i++) {
      const feature: unknown = features[i];
      if (typeof feature !== "string" || !FEATURE_TOKEN.test(feature)) return;
      copiedFeatures.push(feature);
    }
    const { status, code } = request;
    if (
      (status !== "valid" &&
        status !== "invalid" &&
        status !== "empty" &&
        status !== "expired" &&
        status !== "completed") ||
      !validCode(code)
    )
      return;
    const known = status === "invalid" ? knownCode(code, REQUEST_CODES) : undefined;
    return Object.freeze({
      type,
      ...header,
      protocols: Object.freeze([1, 2] as const),
      features: Object.freeze(copiedFeatures),
      request: Object.freeze({ status, ...(known ? { code: known } : {}) }),
    });
  } catch {
    return undefined;
  }
}

function validCode(code: unknown): boolean {
  return code === undefined || (typeof code === "string" && CODE.test(code));
}
function knownCode<T extends string>(code: unknown, known: readonly T[]): T | undefined {
  return known.find((value) => value === code);
}
