import { Result, type Result as ResultType } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFailure } from "./createFailure";
import { LOGGER } from "./logger";

describe("createFailure", () => {
  afterEach(() => vi.restoreAllMocks());

  it("only types a Result the runtime value can satisfy", () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);

    const plain: ResultType<void, { code: "invalid_file" }> = createFailure("event", {
      code: "invalid_file",
    });
    const enriched: ResultType<void, { code: "network_failed"; httpStatus: number }> =
      createFailure("event", {
        code: "network_failed",
        httpStatus: 503,
      });
    // @ts-expect-error a code-only error cannot satisfy a Result that requires extra fields
    const unsatisfiable: ResultType<void, { code: "network_failed"; httpStatus: number }> =
      createFailure("event", {
        code: "network_failed",
      });
    // @ts-expect-error codes outside the Result error union are rejected
    const unknownCode: ResultType<void, { code: "invalid_file" | "network_failed" }> =
      createFailure("event", { code: "unknown_code" });

    expect(Result.isError(plain) && plain.error).toEqual({ code: "invalid_file" });
    expect(Result.isError(enriched) && enriched.error).toEqual({
      code: "network_failed",
      httpStatus: 503,
    });
    expect(Result.isError(unsatisfiable)).toBe(true);
    expect(Result.isError(unknownCode)).toBe(true);
  });

  it("logs the event with error.code and extra fields", () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const error = { code: "invalid_file" as const };

    const result = createFailure("identity.google.drive_store.failed", error, {
      operation: "read_media",
    });

    expect(warn).toHaveBeenCalledWith("identity.google.drive_store.failed", {
      operation: "read_media",
      code: "invalid_file",
    });
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toBe(error);
  });

  it("returns the provided error object when the Result needs extra fields", () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new Error("unavailable");
    const error = { code: "network_failed" as const, cause };

    const result = createFailure("identity.google.drive_store.failed", error, {
      operation: "create_lock",
      errorName: "Error",
    });

    expect(warn).toHaveBeenCalledWith("identity.google.drive_store.failed", {
      operation: "create_lock",
      errorName: "Error",
      code: "network_failed",
    });
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toBe(error);
  });
});
