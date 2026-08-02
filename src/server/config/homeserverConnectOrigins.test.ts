import { afterEach, describe, expect, it, vi } from "vitest";

import { getHomeserverConnectOrigins } from "./homeserverConnectOrigins";

describe("homeserver CSP connect origins", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("normalizes and deduplicates exact HTTPS origins", () => {
    vi.stubEnv(
      "PUBKY_HOMESERVER_CONNECT_ORIGINS",
      "https://homeserver.example/, https://migrated.example, https://homeserver.example",
    );

    expect(getHomeserverConnectOrigins()).toEqual([
      "https://homeserver.example",
      "https://migrated.example",
    ]);
  });

  it.each([
    "http://homeserver.example",
    "https://user:password@homeserver.example",
    "https://homeserver.example/path",
    "https://*.example.com",
    "https://home;server.example",
    "https://192.0.2.1",
    "https://homeserver.example,,https://other.example",
    Array.from({ length: 17 }, (_, index) => `https://homeserver-${index}.example`).join(","),
  ])("rejects unsafe origins: %s", (origins) => {
    vi.stubEnv("PUBKY_HOMESERVER_CONNECT_ORIGINS", origins);

    expect(() => getHomeserverConnectOrigins()).toThrow();
  });
});
