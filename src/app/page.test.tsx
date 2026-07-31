import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../libs/logger/logger";
import Home from "./page";

vi.mock("../ui/developmentIdentityPanel", () => ({ DevelopmentIdentityPanel: () => null }));
vi.mock("../ui/manualAuthorizationForm", () => ({ ManualAuthorizationForm: () => null }));

describe("home page bootstrap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("logs invalid bootstrap configuration without configuration values", () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    vi.stubEnv("GOOGLE_CLIENT_ID", "SECRET-GOOGLE-CLIENT-ID");
    vi.stubEnv("HOMEGATE_URL", "SECRET-HOMEGATE-URL");

    expect(() => Home()).toThrow("Home page configuration unavailable.");
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
