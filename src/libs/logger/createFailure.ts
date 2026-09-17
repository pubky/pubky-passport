import { Result } from "better-result";

import { LOGGER, type LogFields } from "./logger";

/**
 * Builds a helper that logs one stable warn event and returns `Result.err(error)`.
 *
 * `error` is the Result payload. Extra `fields` are logged with `error.code`;
 * pass only log-safe primitives and spread `safeErrorLogFields(cause)` rather
 * than the cause itself. The helper does not throw.
 */
export function createFailure<Code extends string>(event: string) {
  return function failure<Failure extends { readonly code: Code }>(
    error: Failure,
    fields?: LogFields,
  ) {
    LOGGER.warn(event, { ...fields, code: error.code });
    return Result.err(error);
  };
}
