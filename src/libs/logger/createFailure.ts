import { Result } from "better-result";

import { LOGGER, type LogFields } from "./logger";

/**
 * Logs a stable warn event and returns `Result.err(error)`.
 *
 * Extra `fields` are logged with `error.code`. Pass only log-safe primitives
 * and spread `safeErrorLogFields(cause)` rather than the cause itself. Does
 * not throw.
 */
export function createFailure<const Failure extends { readonly code: string }>(
  event: string,
  error: Failure,
  fields?: LogFields,
) {
  LOGGER.warn(event, { ...fields, code: error.code });
  return Result.err(error);
}
