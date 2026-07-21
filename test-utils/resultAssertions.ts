import { Result, type Result as ResultType } from "better-result";
import { expect } from "vitest";

export function expectResultOk<T, E>(result: ResultType<T, E>): T {
  expect(Result.isOk(result)).toBe(true);
  if (Result.isError(result)) {
    throw result.error;
  }

  return result.value;
}

export function expectResultError<T, E>(result: ResultType<T, E>, error: E): void {
  expect(Result.isError(result)).toBe(true);
  if (Result.isError(result)) {
    expect(result.error).toEqual(error);
  }
}

export async function expectAsyncResultError<T, E>(result: Promise<ResultType<T, E>>, error: E): Promise<void> {
  expectResultError(await result, error);
}
