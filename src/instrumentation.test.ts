import { afterEach, describe, expect, it, vi } from "vitest";

import { register } from "./instrumentation";

describe("server instrumentation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("registers the server when the complete application configuration is valid", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("HOMEGATE_URL", "https://homegate.example");
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", "https://homeserver.example");
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "current");
    vi.stubEnv(
      "PASSPORT_SERVER_SECRET_KEYRING_JSON",
      JSON.stringify({
        current: Buffer.alloc(32, 1).toString("base64"),
      }),
    );

    await expect(register()).resolves.toBeUndefined();
  });

  it("fails server registration when application configuration is invalid", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("HOMEGATE_URL", "https://homegate.example");
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", "https://homeserver.example");
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "current");
    vi.stubEnv("PASSPORT_SERVER_SECRET_KEYRING_JSON", JSON.stringify({ current: "invalid" }));

    await expect(register()).rejects.toThrow("Passport server keyring contains an invalid secret");
  });

  it("fails server registration when public configuration is invalid", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("GOOGLE_CLIENT_ID", undefined);
    vi.stubEnv("HOMEGATE_URL", "https://homegate.example");
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", "https://homeserver.example");
    vi.stubEnv("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID", "current");
    vi.stubEnv(
      "PASSPORT_SERVER_SECRET_KEYRING_JSON",
      JSON.stringify({
        current: Buffer.alloc(32, 1).toString("base64"),
      }),
    );

    await expect(register()).rejects.toThrow();
  });

  it("does not load Node configuration in another runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");

    await expect(register()).resolves.toBeUndefined();
  });
});
