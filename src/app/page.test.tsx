import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../libs/logger/logger";
import Home from "./page";

vi.mock("../ui/identity-dashboard/identityDashboard", () => ({ IdentityDashboard: () => null }));

describe("home page bootstrap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects invalid browser bootstrap configuration safely", () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    vi.stubEnv("GOOGLE_CLIENT_ID", "SECRET-GOOGLE-CLIENT-ID");
    vi.stubEnv("HOMEGATE_URL", "SECRET-HOMEGATE-URL");

    expect(() => Home()).toThrow("Home page configuration unavailable.");
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-GOOGLE-CLIENT-ID");
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-HOMEGATE-URL");
  });
});
