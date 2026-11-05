import "client-only";

import { Result } from "better-result";
import { z } from "zod";

import { isCanonicalBase64Url } from "@/libs/encoding/base64Url";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { readBoundedText } from "@/libs/http/boundedBody";
import { HttpResponseError } from "@/libs/http/HttpResponseError";
import { MAXIMUM_JSON_BODY_BYTES, passportKeyIdSchema } from "@/libs/passportPolicy";

const ERROR_CODES = [
  "invalid_request",
  "invalid_google_id_token",
  "key_unavailable",
  "google_verifier_unavailable",
  "key_derivation_failed",
  "internal_error",
] as const;
const SUCCESS_SCHEMA = z
  .object({
    wrappingKey: z.string().length(43).refine(isCanonicalBase64Url),
    keyId: passportKeyIdSchema,
  })
  .strict();
const ERROR_SCHEMA = z
  .object({
    error: z.object({ code: z.enum(ERROR_CODES) }).strict(),
  })
  .strict();

export type WrappingKeyErrorCode =
  (typeof ERROR_CODES)[number] | "invalid_response" | "network_failed";

export type WrappingKeyResult = Result<
  { wrappingKey: string; keyId: string },
  { code: WrappingKeyErrorCode; cause: unknown; httpStatus?: number }
>;

/** Sign-in providers with a same-origin wrapping-key endpoint, and their token field. */
const ID_TOKEN_FIELDS = { google: "googleIdToken" } as const;
export type WrappingKeyProvider = keyof typeof ID_TOKEN_FIELDS;

/** Requests account-bound Passport wrapping keys from the same-origin server endpoint. */
export class WrappingKeyApiClient {
  /**
   * @param fetch Same-origin transport used to call the Passport server endpoint.
   * @param provider Provider whose ID token this client sends.
   */
  constructor(
    private readonly fetch: typeof globalThis.fetch,
    private readonly provider: WrappingKeyProvider,
  ) {}

  /**
   * Requests a wrapping key without exposing the ID token to failure details.
   *
   * @param idToken Provider ID token verified by the server before key derivation.
   * @param keyId Key ID from an existing envelope; omit it to request the current server key.
   * The promise settles with a Result for request and response failures. It does not
   * intentionally reject.
   */
  async requestWrappingKey(idToken: string, keyId?: string): Promise<WrappingKeyResult> {
    const event = `identity.${this.provider}.wrapping_key.failed`;
    const tokenField = ID_TOKEN_FIELDS[this.provider];
    let response: Response;
    try {
      response = await this.fetch(`/api/wrapping-key/${this.provider}`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        // Only the ID token and the public key ID cross this boundary; storage tokens never do.
        body: JSON.stringify(keyId ? { [tokenField]: idToken, keyId } : { [tokenField]: idToken }),
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
    } catch (e) {
      LOGGER.warn(event, {
        operation: "request_wrapping_key",
        stage: "request",
        ...safeErrorLogFields(e),
        code: "network_failed",
      });
      return Result.err({ code: "network_failed", cause: e });
    }

    const contents = await readBoundedText(response, MAXIMUM_JSON_BODY_BYTES);
    if (Result.isError(contents)) {
      LOGGER.warn(event, {
        operation: "request_wrapping_key",
        stage: "response_read",
        httpStatus: response.status,
        ...safeErrorLogFields(contents.error.cause),
        code: "invalid_response",
      });
      return Result.err({
        code: "invalid_response",
        httpStatus: response.status,
        cause: contents.error.cause,
      });
    }

    const responseText = contents.value;
    if (!response.ok) {
      let body: unknown;
      let parseCause: unknown;
      try {
        body = JSON.parse(responseText);
      } catch (e) {
        parseCause = e;
      }
      const parsed = ERROR_SCHEMA.safeParse(body);
      const code = parsed.success ? parsed.data.error.code : "invalid_response";
      const cause = new HttpResponseError(response.status, response.statusText, responseText, {
        cause: parseCause,
      });
      LOGGER.warn(event, {
        operation: "request_wrapping_key",
        stage: "error_response",
        httpStatus: response.status,
        ...safeErrorLogFields(cause),
        code,
      });
      return Result.err({ code, httpStatus: response.status, cause });
    }

    let body: unknown;
    try {
      body = JSON.parse(responseText);
    } catch (e) {
      const responseError = new Error("Wrapping-key response must be valid JSON.", { cause: e });
      LOGGER.warn(event, {
        operation: "request_wrapping_key",
        stage: "response_parse",
        httpStatus: response.status,
        ...safeErrorLogFields(responseError),
        code: "invalid_response",
      });
      return Result.err({
        code: "invalid_response",
        httpStatus: response.status,
        cause: responseError,
      });
    }

    const parsed = SUCCESS_SCHEMA.safeParse(body);
    if (parsed.success && (!keyId || parsed.data.keyId === keyId)) {
      return Result.ok(parsed.data);
    }
    // Zod issues may echo the wrapping key, so retain only a fixed diagnostic cause.
    LOGGER.warn(event, {
      operation: "request_wrapping_key",
      stage: "response_validation",
      httpStatus: response.status,
      code: "invalid_response",
    });
    return Result.err({
      code: "invalid_response",
      httpStatus: response.status,
      cause: new Error("Wrapping-key response does not match the success schema."),
    });
  }
}
