import "server-only";

import { Result, type Result as ResultType } from "better-result";
import { z } from "zod";

import { readBoundedText } from "@/libs/http/boundedBody";
import { MAXIMUM_JSON_BODY_BYTES, passportKeyIdSchema } from "@/libs/passportPolicy";
import type { CodedFailure } from "@/libs/result";

/** JSON field that carries the provider's ID token, for example `googleIdToken`. */
export type IdTokenField = "googleIdToken";

export const WRAPPING_KEY_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;

const REQUEST_SCHEMAS = new Map<IdTokenField, z.ZodType<Record<string, unknown>>>();

function requestSchema(tokenField: IdTokenField) {
  let schema = REQUEST_SCHEMAS.get(tokenField);
  if (!schema) {
    schema = z
      .object({
        [tokenField]: z.string().trim().min(1),
        keyId: passportKeyIdSchema.optional(),
      })
      .strict();
    REQUEST_SCHEMAS.set(tokenField, schema);
  }
  return schema;
}

/** Parses `{ <tokenField>: string, keyId?: string }` from a bounded JSON request body. */
export async function parseIdTokenRequest(
  request: Request,
  tokenField: IdTokenField,
): Promise<
  ResultType<{ idToken: string; keyId?: string | undefined }, CodedFailure<"invalid_request">>
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
    // Parser messages may echo the ID token, so collapse them to a fixed public failure.
    return Result.err({ code: "invalid_request" });
  }

  const parsed = requestSchema(tokenField).safeParse(body);
  if (!parsed.success) return Result.err({ code: "invalid_request" });
  const idToken = parsed.data[tokenField];
  const keyId = parsed.data.keyId;
  if (typeof idToken !== "string") return Result.err({ code: "invalid_request" });
  return Result.ok(typeof keyId === "string" ? { idToken, keyId } : { idToken });
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
