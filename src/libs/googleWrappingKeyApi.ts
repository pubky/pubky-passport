import { z } from "zod";

import { isCanonicalBase64Url } from "./encoding/base64Url";

export const GOOGLE_WRAPPING_KEY_ERROR_CODES = [
  "invalid_request",
  "invalid_google_id_token",
  "key_unavailable",
  "dependency_unavailable",
  "internal_error",
] as const;

export type GoogleWrappingKeyApiErrorCode = (typeof GOOGLE_WRAPPING_KEY_ERROR_CODES)[number];

export const GOOGLE_WRAPPING_KEY_ID_SCHEMA = z.string().regex(/^[A-Za-z0-9._-]{1,32}$/);

export const GOOGLE_WRAPPING_KEY_REQUEST_SCHEMA = z.object({
  googleIdToken: z.string().trim().min(1),
  keyId: GOOGLE_WRAPPING_KEY_ID_SCHEMA.optional(),
}).strict();

const WRAPPING_KEY_LENGTH = Math.ceil((32 * 4) / 3);
const WRAPPING_KEY_SCHEMA = z.string()
  .length(WRAPPING_KEY_LENGTH)
  .refine(isCanonicalBase64Url);

export const GOOGLE_WRAPPING_KEY_SUCCESS_SCHEMA = z.object({
  wrappingKey: WRAPPING_KEY_SCHEMA,
  keyId: GOOGLE_WRAPPING_KEY_ID_SCHEMA,
}).strict();

export type GoogleWrappingKey = { wrappingKey: string; keyId: string };

export const GOOGLE_WRAPPING_KEY_ERROR_SCHEMA = z.object({
  error: z.object({ code: z.enum(GOOGLE_WRAPPING_KEY_ERROR_CODES) }).strict(),
}).strict();
