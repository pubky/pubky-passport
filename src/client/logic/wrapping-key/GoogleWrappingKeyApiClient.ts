import "client-only";

import { Result } from "better-result";
import { z } from "zod";

import { isCanonicalBase64Url } from "@/libs/encoding/base64Url";
import { createFailure } from "@/libs/logger/createFailure";
import { safeErrorLogFields } from "@/libs/logger/logger";
import { readBoundedText } from "@/libs/http/boundedBody";
import { HttpResponseError } from "@/libs/http/HttpResponseError";
import { MAXIMUM_JSON_BODY_BYTES, passportKeyIdSchema } from "@/libs/passportPolicy";

const failure = createFailure<GoogleWrappingKeyErrorCode>("identity.google.wrapping_key.failed");
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

export type GoogleWrappingKeyErrorCode =
  (typeof ERROR_CODES)[number] | "invalid_response" | "network_failed";

export type GoogleWrappingKeyResult = Result<
  { wrappingKey: string; keyId: string },
  { code: GoogleWrappingKeyErrorCode; cause: unknown; httpStatus?: number }
>;

/** Requests account-bound Passport wrapping keys from the same-origin server endpoint. */
export class GoogleWrappingKeyApiClient {
  /** @param fetch Same-origin transport used to call the Passport server endpoint. */
  constructor(private readonly fetch: typeof globalThis.fetch) {}

  /**
   * Requests a wrapping key without exposing the Google token to failure details.
   *
   * @param googleIdToken Google credential verified by the server before key derivation.
   * @param keyId Key ID from an existing envelope; omit it to request the current server key.
   * The promise settles with a Result for request and response failures. It does not
   * intentionally reject.
   */
  async requestGoogleWrappingKey(
    googleIdToken: string,
    keyId?: string,
  ): Promise<GoogleWrappingKeyResult> {
    let response: Response;
    try {
      response = await this.fetch("/api/wrapping-key/google", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        // The optional key ID is public envelope metadata; Drive tokens never cross this boundary.
        body: JSON.stringify(keyId ? { googleIdToken, keyId } : { googleIdToken }),
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
    } catch (e) {
      return failure(
        { code: "network_failed", cause: e },
        {
          operation: "request_google_wrapping_key",
          stage: "request",
          ...safeErrorLogFields(e),
        },
      );
    }

    const contents = await readBoundedText(response, MAXIMUM_JSON_BODY_BYTES);
    if (Result.isError(contents)) {
      return failure(
        {
          code: "invalid_response",
          httpStatus: response.status,
          cause: contents.error.cause,
        },
        {
          operation: "request_google_wrapping_key",
          stage: "response_read",
          httpStatus: response.status,
          ...safeErrorLogFields(contents.error.cause),
        },
      );
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
      return failure(
        { code, httpStatus: response.status, cause },
        {
          operation: "request_google_wrapping_key",
          stage: "error_response",
          httpStatus: response.status,
          ...safeErrorLogFields(cause),
        },
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(responseText);
    } catch (e) {
      const responseError = new Error("Wrapping-key response must be valid JSON.", { cause: e });
      return failure(
        {
          code: "invalid_response",
          httpStatus: response.status,
          cause: responseError,
        },
        {
          operation: "request_google_wrapping_key",
          stage: "response_parse",
          httpStatus: response.status,
          ...safeErrorLogFields(responseError),
        },
      );
    }

    const parsed = SUCCESS_SCHEMA.safeParse(body);
    if (parsed.success && (!keyId || parsed.data.keyId === keyId)) {
      return Result.ok(parsed.data);
    }
    // Zod issues may echo the wrapping key, so retain only a fixed diagnostic cause.
    return failure(
      {
        code: "invalid_response",
        httpStatus: response.status,
        cause: new Error("Wrapping-key response does not match the success schema."),
      },
      {
        operation: "request_google_wrapping_key",
        stage: "response_validation",
        httpStatus: response.status,
      },
    );
  }
}
