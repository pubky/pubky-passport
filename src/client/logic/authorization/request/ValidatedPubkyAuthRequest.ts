import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import {
  parseEncodedPubkyAuthRequest,
  type ParsedPubkyAuthRequest,
  type PubkyAuthenticationMethod,
  type PubkyAuthParseError,
} from "./parser/pubkyAuthRequestParser";
import type { ValidatedPubkyAuthCallbacks } from "./parser/pubkyAuthUrls";

/** One safe capability row rendered during authorization review. */
type AuthorizationCapability = Readonly<{
  path: string;
  read: boolean;
  write: boolean;
  encrypt: boolean;
  scope: "specific" | "broad";
}>;

/** Safe, immutable request data that may enter React state and rendered output. */
export type AuthorizationRequestReview = Readonly<{
  authenticationMethod: PubkyAuthenticationMethod;
  capabilities: readonly AuthorizationCapability[];
  requesterName?: string;
  callbackHost?: string;
}>;

type ValidatedAuthorizationMetadata = Readonly<{
  callbacks: Readonly<ValidatedPubkyAuthCallbacks>;
  sensitivePubkyAuthUrl: string;
}>;

export type ValidatedPubkyAuthRequestResult = ResultType<
  ValidatedPubkyAuthRequest,
  PubkyAuthParseError
>;

/**
 * A validated Pubky Auth request and the authority to approve that exact request.
 * Only the safe `review` property may be exposed to UI state.
 */
export class ValidatedPubkyAuthRequest {
  #metadata: ValidatedAuthorizationMetadata | undefined;

  private constructor(
    readonly review: AuthorizationRequestReview,
    metadata: ValidatedAuthorizationMetadata,
  ) {
    this.#metadata = metadata;
  }

  /** Creates one validated request for review and later approval. */
  static fromEncoded(encodedRequest: unknown): ValidatedPubkyAuthRequestResult {
    const parsed = parseEncodedPubkyAuthRequest(encodedRequest);
    if (Result.isError(parsed)) return Result.err(parsed.error);

    const review = createAuthorizationReview(parsed.value);
    const request = new ValidatedPubkyAuthRequest(
      review,
      Object.freeze({
        callbacks: parsed.value.callbacks,
        sensitivePubkyAuthUrl: parsed.value.sensitivePubkyAuthUrl,
      }),
    );

    Object.freeze(request);
    return Result.ok(request);
  }

  /**
   * Returns the reviewed URL with only the declined encryption permissions removed.
   * Storage actions and the requested approval format/recipient remain unchanged.
   */
  validatedUrlForApproval(declinedEncryptionPaths: readonly string[] = []): string | undefined {
    const originalUrl = this.#metadata?.sensitivePubkyAuthUrl;
    if (!originalUrl) return undefined;
    if (declinedEncryptionPaths.length === 0) return originalUrl;

    const encryptionPaths = new Set(
      this.review.capabilities.filter((capability) => capability.encrypt).map(({ path }) => path),
    );
    if (declinedEncryptionPaths.some((path) => !encryptionPaths.has(path))) return undefined;

    const capabilities = this.review.capabilities.flatMap((capability) => {
      // A directory key can derive all descendant keys. Removing a child permission must
      // therefore remove a covering directory key as well, while retaining its storage access.
      const encrypt =
        capability.encrypt &&
        !declinedEncryptionPaths.some(
          (path) =>
            capability.path === path ||
            (capability.path.endsWith("/") && path.startsWith(capability.path)),
        );
      const actions = `${capability.read ? "r" : ""}${capability.write ? "w" : ""}${encrypt ? "e" : ""}`;
      return actions ? [`${capability.path}:${actions}`] : [];
    });
    const narrowedUrl = new URL(originalUrl);
    narrowedUrl.searchParams.set("caps", capabilities.join(","));
    return narrowedUrl.toString();
  }

  isLive(): boolean {
    return this.#metadata !== undefined;
  }

  /** Takes one validated callback and releases all remaining private metadata. */
  takeOutcomeCallback(outcome: keyof ValidatedPubkyAuthCallbacks): string | undefined {
    try {
      return this.#metadata?.callbacks[outcome];
    } catch (e) {
      LOGGER.warn("authorize.request_metadata.failed", {
        operation: "take_outcome_callback",
        ...safeErrorLogFields(e),
      });
      return undefined;
    } finally {
      this.#metadata = undefined;
    }
  }

  /** Releases private metadata when the request completes or is abandoned. */
  release(): void {
    this.#metadata = undefined;
  }
}

function createAuthorizationReview(
  parsed: Pick<
    ParsedPubkyAuthRequest,
    "authenticationMethod" | "capabilities" | "callbacks" | "source"
  >,
): AuthorizationRequestReview {
  const capabilities = Object.freeze(
    parsed.capabilities.map((capability) =>
      Object.freeze({
        ...capability,
        scope: getCapabilityScope(capability.path),
      }),
    ),
  );
  const callbackHost = getCallbackHost(parsed.callbacks);

  return Object.freeze({
    authenticationMethod: parsed.authenticationMethod,
    capabilities,
    ...(parsed.source ? { requesterName: parsed.source } : {}),
    ...(callbackHost ? { callbackHost } : {}),
  });
}

function getCapabilityScope(path: string): AuthorizationCapability["scope"] {
  return path === "/" || path === "/pub/" || path === "/priv/" ? "broad" : "specific";
}

function getCallbackHost(callbacks: Readonly<ValidatedPubkyAuthCallbacks>): string | undefined {
  const displayCallback = callbacks.success ?? callbacks.error ?? callbacks.cancel;
  if (!displayCallback) return undefined;

  try {
    // URL.host preserves punycode and non-default ports without displaying userinfo.
    return new URL(displayCallback).host || undefined;
  } catch {
    return undefined;
  }
}
