import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFailure } from "./createFailure";
import { LOGGER } from "./logger";

describe("createFailure", () => {
  afterEach(() => vi.restoreAllMocks());

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
