import { Result, type Result as ResultType } from "better-result";

import { LOGGER, type LogFields } from "./logger";

/**
 * Builds a log-and-return helper for one stable warn event.
 *
 * Logs `fields` as-is. When `error` is omitted, the Result is `{ code: fields.code }`.
 * Pass `error` when the Result must keep extra fields such as `cause` or `httpStatus`.
 * The helper does not throw.
 */
export function createFailure(event: string) {
  return function failure<
    Success,
    Code extends string,
    Failure extends { readonly code: Code } = { code: Code },
  >(fields: LogFields & { code: Code }, error?: Failure): ResultType<Success, Failure> {
    LOGGER.warn(event, fields);
    return Result.err((error ?? { code: fields.code }) as Failure);
  };
}
