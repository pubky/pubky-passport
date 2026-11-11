import "server-only";

import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { Result, type Result as ResultType } from "better-result";

import { readBoundedText } from "@/libs/http/boundedBody";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import type { VerifiedProviderIdentity } from "../deriveWrappingKey";

export const APPLE_ISSUER = "https://appleid.apple.com";
export const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";

export type AppleIdTokenVerificationResult = ResultType<
  VerifiedProviderIdentity,
  CodedFailure<"apple_verifier_unavailable" | "invalid_apple_id_token">
>;

type AppleSigningKeys = { keys: ReadonlyMap<string, KeyObject>; fetchedAt: number };

const MAXIMUM_ID_TOKEN_CHARACTERS = 8 * 1024;
const MAXIMUM_KEYS_RESPONSE_BYTES = 64 * 1024;
const MAXIMUM_SUBJECT_CHARACTERS = 255;
const KEYS_FETCH_TIMEOUT_MS = 5_000;
/** Apple rotates keys rarely; refetch at most hourly unless a token names an unknown key. */
const KEYS_MAX_AGE_MS = 60 * 60 * 1000;
/** An unknown `kid` forces a refetch, but never more often than this, so tokens cannot drive load. */
const KEYS_MINIMUM_REFRESH_INTERVAL_MS = 60 * 1000;
/** After a failed refresh, keep using the cached keys and wait this long before trying again. */
const KEYS_REFRESH_BACKOFF_MS = 60 * 1000;
/** Keys Apple may have withdrawn are not trusted for longer than this without a refresh. */
const KEYS_MAXIMUM_STALE_MS = 24 * 60 * 60 * 1000;
/** Apple ID tokens live for ten minutes; allow a small clock skew for `iat`. */
const CLOCK_SKEW_SECONDS = 60;
const MAXIMUM_TOKEN_AGE_SECONDS = 10 * 60 + CLOCK_SKEW_SECONDS;

/**
 * Verifies Sign in with Apple ID tokens: RS256 signature with Apple's published keys, issuer,
 * audience (the configured Services ID), expiry, issue time, a present nonce, and the subject.
 * Only `iss` and `sub` leave this class. Apple's `code` is never redeemed, so Passport holds no
 * Apple client secret.
 */
export class AppleIdTokenVerifier {
  private signingKeys: AppleSigningKeys | undefined;
  private pendingFetch: Promise<AppleSigningKeys> | undefined;
  private lastForcedRefreshAt = Number.NEGATIVE_INFINITY;
  private lastFailedRefreshAt = Number.NEGATIVE_INFINITY;

  /**
   * @param audience Services ID that every accepted token must target.
   * @param fetchImpl Transport for Apple's key endpoint.
   * @param now Clock in milliseconds.
   */
  constructor(
    private readonly audience: string,
    private readonly fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {}

  /** Settles with a Result for key-fetch and token failures; it does not intentionally reject. */
  async verifyIdToken(idToken: string): Promise<AppleIdTokenVerificationResult> {
    const parsed = parseCompactJwt(idToken);
    if (!parsed) return invalid("malformed_token");
    const { header, payload, signedInput, signature } = parsed;
    if (header.alg !== "RS256") return invalid("unsupported_algorithm");
    if (typeof header.kid !== "string" || header.kid.length === 0 || header.kid.length > 128) {
      return invalid("missing_key_id");
    }

    let key: KeyObject | undefined;
    try {
      key = await this.signingKey(header.kid);
    } catch (e) {
      LOGGER.error("identity.apple.id_token_verification.failed", {
        code: "apple_verifier_unavailable",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "apple_verifier_unavailable", cause: e });
    }
    if (!key) return invalid("unknown_key_id");

    let signatureValid: boolean;
    try {
      signatureValid = verify("RSA-SHA256", signedInput, key, signature);
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) return invalid("invalid_signature");

    return this.validateClaims(payload);
  }

  private validateClaims(payload: Record<string, unknown>): AppleIdTokenVerificationResult {
    if (payload.iss !== APPLE_ISSUER) return invalid("invalid_issuer");
    if (!audienceMatches(payload.aud, this.audience)) return invalid("invalid_audience");

    const nowSeconds = Math.floor(this.now() / 1000);
    const { exp, iat } = payload;
    if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= nowSeconds) {
      return invalid("expired");
    }
    if (
      typeof iat !== "number" ||
      !Number.isFinite(iat) ||
      iat > nowSeconds + CLOCK_SKEW_SECONDS ||
      iat < nowSeconds - MAXIMUM_TOKEN_AGE_SECONDS
    ) {
      return invalid("invalid_issued_at");
    }
    // Passport always sends a nonce and the browser checks it; a token without one was not
    // minted for a Passport sign-in.
    if (typeof payload.nonce !== "string" || payload.nonce.length === 0) {
      return invalid("missing_nonce");
    }
    const { sub } = payload;
    if (typeof sub !== "string" || !sub.trim() || sub.length > MAXIMUM_SUBJECT_CHARACTERS) {
      return invalid("invalid_subject");
    }

    return Result.ok(Object.freeze({ provider: "apple", issuer: APPLE_ISSUER, subject: sub }));
  }

  /**
   * Returns the key for `kid` from a cached key set. A stale cache is refreshed; an unknown
   * `kid` forces one refresh per {@link KEYS_MINIMUM_REFRESH_INTERVAL_MS} to follow rotation.
   * @throws when Apple's key set cannot be fetched or parsed and no usable cache exists.
   */
  private async signingKey(kid: string): Promise<KeyObject | undefined> {
    const now = this.now();
    let keys = this.signingKeys;
    const stale = !keys || now - keys.fetchedAt > KEYS_MAX_AGE_MS;
    // Back off after a failed fetch even without cached keys, so tokens cannot make every
    // request reach out to Apple while Apple is unreachable.
    const backingOff = now - this.lastFailedRefreshAt < KEYS_REFRESH_BACKOFF_MS;
    let fetchedNow = false;
    if (stale && !backingOff) {
      try {
        keys = await this.fetchSigningKeys();
        fetchedNow = true;
      } catch (e) {
        this.lastFailedRefreshAt = now;
        if (!keys) throw e;
        LOGGER.warn("identity.apple.signing_keys.refresh_failed", safeErrorLogFields(e));
      }
    }
    if (!keys) throw new Error("Apple key set is unavailable.");
    if (now - keys.fetchedAt > KEYS_MAXIMUM_STALE_MS) {
      throw new Error("Apple key set is too old to trust.");
    }
    const cached = keys.keys.get(kid);
    if (cached) return cached;

    if (
      fetchedNow ||
      backingOff ||
      now - this.lastForcedRefreshAt < KEYS_MINIMUM_REFRESH_INTERVAL_MS
    ) {
      return undefined;
    }
    this.lastForcedRefreshAt = now;
    try {
      keys = await this.fetchSigningKeys();
    } catch (e) {
      this.lastFailedRefreshAt = now;
      throw e;
    }
    return keys.keys.get(kid);
  }

  private fetchSigningKeys(): Promise<AppleSigningKeys> {
    this.pendingFetch ??= this.loadSigningKeys().finally(() => {
      this.pendingFetch = undefined;
    });
    return this.pendingFetch;
  }

  private async loadSigningKeys(): Promise<AppleSigningKeys> {
    const response = await this.fetchImpl(APPLE_KEYS_URL, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(KEYS_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Apple key set request failed with ${response.status}.`);
    const text = await readBoundedText(response, MAXIMUM_KEYS_RESPONSE_BYTES);
    if (Result.isError(text)) throw new Error("Apple key set response is unreadable.");
    const keys = parseKeySet(JSON.parse(text.value));
    if (keys.size === 0) throw new Error("Apple key set contains no usable RS256 keys.");
    const signingKeys = { keys, fetchedAt: this.now() };
    this.signingKeys = signingKeys;
    return signingKeys;
  }
}

function parseKeySet(value: unknown): Map<string, KeyObject> {
  const keys = new Map<string, KeyObject>();
  if (!isRecord(value) || !Array.isArray(value.keys)) return keys;
  for (const jwk of value.keys) {
    if (!isRecord(jwk)) continue;
    const { kid, kty, alg, use, n, e } = jwk;
    if (
      typeof kid !== "string" ||
      kty !== "RSA" ||
      typeof n !== "string" ||
      typeof e !== "string"
    ) {
      continue;
    }
    if (alg !== undefined && alg !== "RS256") continue;
    if (use !== undefined && use !== "sig") continue;
    try {
      const key = createPublicKey({ key: { kty, n, e }, format: "jwk" });
      if ((key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048) keys.set(kid, key);
    } catch {
      // Skip keys Node cannot import; the remaining keys stay usable.
    }
  }
  return keys;
}

type ParsedJwt = {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signedInput: Buffer;
  signature: Buffer;
};

function parseCompactJwt(token: string): ParsedJwt | undefined {
  if (token.length > MAXIMUM_ID_TOKEN_CHARACTERS) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  if (![encodedHeader, encodedPayload, encodedSignature].every(isBase64Url)) return undefined;
  const header = decodeJsonPart(encodedHeader);
  const payload = decodeJsonPart(encodedPayload);
  if (!header || !payload) return undefined;
  return {
    header,
    payload,
    signedInput: Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii"),
    signature: Buffer.from(encodedSignature, "base64url"),
  };
}

function decodeJsonPart(part: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function audienceMatches(audience: unknown, expected: string): boolean {
  if (Array.isArray(audience)) return audience.length === 1 && audience[0] === expected;
  return audience === expected;
}

/** Unpadded base64url with zero trailing bits, so each part has exactly one accepted spelling. */
function isBase64Url(value: string): boolean {
  if (value.length === 0 || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    return false;
  }
  return Buffer.from(value, "base64url").toString("base64url") === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(reason: string): AppleIdTokenVerificationResult {
  LOGGER.warn("identity.apple.id_token_verification.failed", {
    code: "invalid_apple_id_token",
    reason,
  });
  return Result.err({ code: "invalid_apple_id_token" });
}
