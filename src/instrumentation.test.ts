import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubPassportEnvironment } from "@test-utils/passportEnvironment";
import { register } from "./instrumentation";

const INVITE_ONLY_PROVIDER = JSON.stringify({
  googleEnabled: false,
  verificationMethods: ["invite"],
});

describe("server instrumentation", () => {
  beforeEach(() => {
    stubPassportEnvironment();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("registers the server when the complete application configuration is valid", async () => {
    await expect(register()).resolves.toBeUndefined();
  });

  it("fails server registration when application configuration is invalid", async () => {
    vi.stubEnv("PASSPORT_SERVER_SECRET_KEYRING_JSON", JSON.stringify({ current: "invalid" }));

    await expect(register()).rejects.toThrow("Passport server keyring contains an invalid secret");
  });

  it("fails server registration when public configuration is invalid", async () => {
    vi.stubEnv("HOMEGATE_URL", "invalid");

    await expect(register()).rejects.toThrow("HOMEGATE_URL must be a valid HTTPS origin.");
  });

  it("fails server registration when Google is enabled without a client ID", async () => {
    vi.stubEnv("PASSPORT_PROVIDER_CONFIG_JSON", JSON.stringify({ googleEnabled: true }));
    vi.stubEnv("GOOGLE_CLIENT_ID", undefined);

    await expect(register()).rejects.toThrow(
      "GOOGLE_CLIENT_ID is required when Google is enabled.",
    );
  });

  it("validates the keyring whenever Google is enabled", async () => {
    vi.stubEnv("PASSPORT_SERVER_SECRET_KEYRING_JSON", undefined);

    await expect(register()).rejects.toThrow("PASSPORT_SERVER_SECRET_KEYRING_JSON is required.");
  });

  it("does not load Node configuration in another runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("HOMEGATE_URL", "invalid");

    await expect(register()).resolves.toBeUndefined();
  });

  it.each([
    ["Google is unconfigured", { GOOGLE_CLIENT_ID: "" }],
    [
      "the provider disables Google despite a client ID",
      { PASSPORT_PROVIDER_CONFIG_JSON: INVITE_ONLY_PROVIDER, HOMEGATE_URL: undefined },
    ],
  ])("does not require a keyring when %s", async (_, overrides) => {
    stubPassportEnvironment({
      ...overrides,
      PASSPORT_SERVER_SECRET_CURRENT_KEY_ID: undefined,
      PASSPORT_SERVER_SECRET_KEYRING_JSON: undefined,
    });

    await expect(register()).resolves.toBeUndefined();
  });
});
