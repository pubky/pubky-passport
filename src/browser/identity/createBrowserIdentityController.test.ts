/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, describe, expect, it } from "vitest";

import { createBrowserIdentityController } from "./createBrowserIdentityController";

describe("createBrowserIdentityController", () => {
  afterEach(() => localStorage.clear());

  it("constructs and disposes the production browser identity graph", () => {
    const controller = createBrowserIdentityController({
      googleClientId: "google-client-id",
      passportUrl: "https://localhost:3000",
    });

    const identities = controller.list();
    expect(Result.isError(identities)).toBe(false);
    if (Result.isError(identities)) throw new Error(identities.error.code);
    expect(identities.value).toEqual({ activeIdentityId: null, identities: [] });

    controller.dispose();
  });
});
