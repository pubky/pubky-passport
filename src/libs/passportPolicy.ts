import { z } from "zod";

export const PASSPORT_KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;
export const passportKeyIdSchema = z.string().regex(PASSPORT_KEY_ID_PATTERN);

export const MAXIMUM_JSON_BODY_BYTES = 16 * 1024;
export const MAXIMUM_URL_CHARACTERS = 2_048;
export const REQUEST_TIMEOUT_MS = 10_000;
export const NETWORK_OPERATION_TIMEOUT_MS = 30_000;
export const AUTHORIZATION_TIMEOUT_MS = 5 * 60_000;
export const AUTHORIZATION_CAPTURE_MAX_CHARACTERS = 32_768;
