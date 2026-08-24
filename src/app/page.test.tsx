import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../libs/logger/logger";
import Home from "./page";

vi.mock("../client/ui/identity-dashboard/identityDashboard", () => ({ IdentityDashboard: () => null }));

describe("home page bootstrap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects invalid browser bootstrap configuration safely", () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    vi.stubEnv("GOOGLE_CLIENT_ID", "SECRET-GOOGLE-CLIENT-ID");
    vi.stubEnv("HOMEGATE_URL", "SECRET-HOMEGATE-URL");

    let outwardError: unknown;
    try {
      Home();
    } catch (cause) {
      outwardError = cause;
    }

    expect(outwardError).toBeInstanceOf(Error);
    expect((outwardError as Error).message).toBe("Home page configuration unavailable.");
    expect((outwardError as Error).cause).toBeUndefined();
    expect(error).toHaveBeenCalledWith("page.bootstrap.failed", {
      route: "home",
      layer: "page",
      operation: "bootstrap",
      stage: "configuration",
      code: "invalid_configuration",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-GOOGLE-CLIENT-ID");
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-HOMEGATE-URL");
  });
});
