import { Result, type Result as ResultType } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFailure } from "./createFailure";
import { LOGGER } from "./logger";

describe("createFailure", () => {
  afterEach(() => vi.restoreAllMocks());

  it("only types a Result the runtime value can satisfy", () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const failure = createFailure<"invalid_file" | "network_failed">("event");

    const plain: ResultType<void, { code: "invalid_file" }> = failure({ code: "invalid_file" });
    const enriched: ResultType<void, { code: "network_failed"; httpStatus: number }> = failure(
      { code: "network_failed", httpStatus: 503 },
      { code: "network_failed", httpStatus: 503 },
    );
    // @ts-expect-error the { code } fallback cannot satisfy a Result error with required extra fields
    const unsatisfiable: ResultType<void, { code: "network_failed"; httpStatus: number }> = failure(
      {
        code: "network_failed",
      },
    );
    // @ts-expect-error the logged code must match the returned error code
    failure({ code: "invalid_file" }, { code: "network_failed" });
    // @ts-expect-error codes outside the factory's union are rejected
    failure({ code: "unknown_code" });

    expect(Result.isError(plain) && plain.error).toEqual({ code: "invalid_file" });
    expect(Result.isError(enriched) && enriched.error).toEqual({
      code: "network_failed",
      httpStatus: 503,
    });
    expect(Result.isError(unsatisfiable)).toBe(true);
  });

  it("logs the parameterized event and returns { code } when no error is passed", () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const failure = createFailure("identity.google.drive_store.failed");
    const fields = { operation: "read_media", code: "invalid_file" as const };

    const result = failure(fields);

    expect(warn).toHaveBeenCalledWith("identity.google.drive_store.failed", fields);
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "invalid_file" });
  });

  it("returns the provided error object when the Result needs extra fields", () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const failure = createFailure("identity.google.drive_store.failed");
    const cause = new Error("unavailable");
    const error = { code: "network_failed" as const, cause };

    const result = failure(
      { operation: "create_lock", code: "network_failed", errorName: "Error" },
      error,
    );

    expect(warn).toHaveBeenCalledWith("identity.google.drive_store.failed", {
      operation: "create_lock",
      code: "network_failed",
      errorName: "Error",
    });
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toBe(error);
  });
});
