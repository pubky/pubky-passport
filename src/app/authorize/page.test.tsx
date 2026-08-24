/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../libs/logger/logger";
import AuthorizePage from "./page";

vi.mock("../../client/ui/authorization/authorizationFlow", () => ({
  AuthorizationFlow: ({ googleClientId, homegateBaseUrl }: {
    googleClientId: string;
    homegateBaseUrl: string;
  }) => <main>{googleClientId}|{homegateBaseUrl}</main>,
}));

describe("AuthorizePage", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("HOMEGATE_URL", "https://homegate.example/api");
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", "https://homeserver.example");
    vi.stubEnv("PASSPORT_SERVER_SECRET_BASE64", Buffer.alloc(32, 1).toString("base64"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("renders the authorization feature with browser configuration", () => {
    render(<AuthorizePage />);
    expect(screen.getByText("google-client-id|https://homegate.example/api/")).toBeInTheDocument();
  });

  it("rejects invalid browser bootstrap configuration safely", () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    vi.stubEnv("GOOGLE_CLIENT_ID", "SECRET-GOOGLE-CLIENT-ID");
    vi.stubEnv("HOMEGATE_URL", "SECRET-HOMEGATE-URL");

    let outwardError: unknown;
    try {
      AuthorizePage();
    } catch (cause) {
      outwardError = cause;
    }

    expect(outwardError).toBeInstanceOf(Error);
    expect((outwardError as Error).message).toBe("Authorization page configuration unavailable.");
    expect((outwardError as Error).cause).toBeUndefined();
    expect(error).toHaveBeenCalledWith("page.bootstrap.failed", {
      route: "authorize",
      layer: "page",
      operation: "bootstrap",
      stage: "configuration",
      code: "invalid_configuration",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-GOOGLE-CLIENT-ID");
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-HOMEGATE-URL");
  });
});
