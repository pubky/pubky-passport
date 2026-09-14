import { Result, type Result as ResultType } from "better-result";

import { LOGGER, type LogFields } from "./logger";

/**
 * Builds a log-and-return helper for one stable warn event whose codes are drawn from `Code`.
 *
 * Logs `fields` as-is: callers pass only log-safe primitives and spread `safeErrorLogFields(cause)`
 * rather than the cause itself. Without `error`, the Result is `{ code: fields.code }`; pass
 * `error` when the Result must keep extra fields such as `cause` or `httpStatus`, and its `code`
 * must match `fields.code`. The helper does not throw.
 */
export function createFailure<Code extends string>(event: string) {
  function failure<Success, FieldCode extends Code>(
    fields: LogFields & { code: FieldCode },
  ): ResultType<Success, { code: FieldCode }>;
  function failure<Success, Failure extends { readonly code: Code }>(
    fields: LogFields & { code: Failure["code"] },
    error: Failure,
  ): ResultType<Success, Failure>;
  function failure(fields: LogFields & { code: Code }, error?: { readonly code: Code }) {
    LOGGER.warn(event, fields);
    return Result.err(error ?? { code: fields.code });
  }
  return failure;
}
