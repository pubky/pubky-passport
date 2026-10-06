import "server-only";

import { Result, type Result as ResultType } from "better-result";
import { z } from "zod";

import { isGoogleNoncePreimage } from "@/libs/googleNonce";
import { readBoundedText } from "@/libs/http/boundedBody";
import { MAXIMUM_JSON_BODY_BYTES, passportKeyIdSchema } from "@/libs/passportPolicy";
import type { CodedFailure } from "@/libs/result";
import { isRecord } from "@/libs/typeGuards";

const REQUEST_SCHEMA = z
  .object({
    googleIdToken: z.string().trim().min(1),
    /** The preimage of the token's `nonce`; see `isGoogleNoncePreimage`. */
    googleNoncePreimage: z.string().refine(isGoogleNoncePreimage),
    keyId: passportKeyIdSchema.optional(),
  })
  .strict();

export type GoogleWrappingKeyRequest = {
  googleIdToken: string;
  googleNoncePreimage: string;
  keyId?: string | undefined;
};

export const GOOGLE_WRAPPING_KEY_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;

/**
 * `reload_required` is a request from a page loaded before Passport asked for the nonce's
 * preimage (a token and nothing else): it gets a fresh page, not a generic failure.
 */
export async function parseGoogleIdTokenRequest(
  request: Request,
): Promise<
  ResultType<GoogleWrappingKeyRequest, CodedFailure<"invalid_request" | "reload_required">>
> {
  if (!isJsonContentType(request.headers.get("Content-Type"))) {
    return Result.err({ code: "invalid_request" });
  }
  if (request.body === null) return Result.err({ code: "invalid_request" });

  const text = await readBoundedText(request, MAXIMUM_JSON_BODY_BYTES);
  if (Result.isError(text)) {
    return Result.err(
      text.error.code === "body_unavailable"
        ? { code: "invalid_request", cause: text.error.cause }
        : { code: "invalid_request" },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text.value);
  } catch {
    // Parser messages may echo the Google ID token, so collapse them to a fixed public failure.
    return Result.err({ code: "invalid_request" });
  }

  if (isRecord(body) && typeof body.googleIdToken === "string" && !("googleNoncePreimage" in body))
    return Result.err({ code: "reload_required" });
  const parsed = REQUEST_SCHEMA.safeParse(body);
  return parsed.success ? Result.ok(parsed.data) : Result.err({ code: "invalid_request" });
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
