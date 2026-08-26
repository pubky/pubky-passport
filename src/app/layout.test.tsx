import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../libs/logger/logger";
import RootLayout from "./layout";

const MOCKS = vi.hoisted(() => ({ connection: vi.fn() }));

vi.mock("@fontsource-variable/inter-tight", () => ({}));
vi.mock("./globals.css", () => ({}));
vi.mock("next/server", () => ({ connection: MOCKS.connection }));

describe("RootLayout bootstrap", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("HOMEGATE_URL", "https://homegate.example/api");
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", "https://homeserver.example");
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "current");
    vi.stubEnv("PASSPORT_SERVER_SECRET_KEYRING_JSON", JSON.stringify({
      current: Buffer.alloc(32, 1).toString("base64"),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects invalid bootstrap configuration without exposing its values", async () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    vi.stubEnv("GOOGLE_CLIENT_ID", "SECRET-GOOGLE-CLIENT-ID");
    vi.stubEnv("HOMEGATE_URL", "SECRET-HOMEGATE-URL");

    await expect(RootLayout({ children: null })).rejects.toThrow(
      "Application configuration unavailable.",
    );
    expect(error).toHaveBeenCalledWith("layout.bootstrap.failed", {
      layer: "layout",
      operation: "bootstrap",
      stage: "configuration",
      code: "invalid_configuration",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-GOOGLE-CLIENT-ID");
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-HOMEGATE-URL");
  });
});
