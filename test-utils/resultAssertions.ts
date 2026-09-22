import { Result, type Result as ResultType } from "better-result";
import { expect } from "vitest";

export function expectResultOk<Success, Failure>(result: ResultType<Success, Failure>): Success {
  expect(Result.isOk(result)).toBe(true);
  if (Result.isError(result)) {
    throw result.error;
  }

  return result.value;
}

export function expectResultError<Success, Failure>(
  result: ResultType<Success, Failure>,
  error: Failure,
): void {
  expect(Result.isError(result)).toBe(true);
  if (Result.isError(result)) {
    expect(result.error).toEqual(error);
  }
}

export async function expectAsyncResultError<Success, Failure>(
  result: Promise<ResultType<Success, Failure>>,
  error: Failure,
): Promise<void> {
  expectResultError(await result, error);
}
