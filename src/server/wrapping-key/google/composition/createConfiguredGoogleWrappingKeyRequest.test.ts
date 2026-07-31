import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleWrappingKeyRequest } from "../application/googleWrappingKeyRequest";
import { createConfiguredGoogleWrappingKeyRequest } from "./createConfiguredGoogleWrappingKeyRequest";

describe("configured Google wrapping-key request", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("constructs the configured server flow", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("PASSPORT_SERVER_SECRET_BASE64", Buffer.alloc(32, 1).toString("base64"));

    expect(createConfiguredGoogleWrappingKeyRequest()).toBeInstanceOf(GoogleWrappingKeyRequest);
  });
});
