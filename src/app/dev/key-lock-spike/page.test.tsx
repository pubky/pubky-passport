import { afterEach, expect, it, vi } from "vitest";

import KeyLockSpikePage from "./page";

afterEach(() => vi.unstubAllEnvs());

it("returns the real Next 404 in production", () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(() => KeyLockSpikePage()).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
});

it("renders the spike only in development", () => {
  vi.stubEnv("NODE_ENV", "development");
  expect(KeyLockSpikePage()).toBeDefined();
});
