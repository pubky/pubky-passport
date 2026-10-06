/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";

import { MAINNET } from "@/libs/pubkyNetwork";
import { configurePubkyNetwork, installUrlRewrites, pubkyNetwork } from "./pubkyNetwork";

const REWRITES = [
  { from: "http://localhost:6286", to: "https://gateway.example/_pubky/homeserver" },
];

function scope() {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("ok"));
  return { fetch: fetch as typeof globalThis.fetch, calls: fetch.mock.calls };
}

describe("installUrlRewrites", () => {
  it("sends a covered string or URL to its target, with the caller's init", async () => {
    const target = scope();
    installUrlRewrites(target, REWRITES);
    const init = { method: "PUT", body: "x", headers: { "pubky-host": "key" } };
    await target.fetch("http://localhost:6286/pub/a.json", init);
    await target.fetch(new URL("http://localhost:6286/session"));
    expect(target.calls).toEqual([
      ["https://gateway.example/_pubky/homeserver/pub/a.json", init],
      ["https://gateway.example/_pubky/homeserver/session", undefined],
    ]);
  });

  it("rebuilds a covered Request with its method, headers and body", async () => {
    const target = scope();
    installUrlRewrites(target, REWRITES);
    await target.fetch(
      new Request("http://localhost:6286/pub/a.json", {
        method: "PUT",
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        body: '{"name":"Alice"}',
        credentials: "include",
      }),
    );
    const [sent] = target.calls[0]! as [Request];
    expect(sent.url).toBe("https://gateway.example/_pubky/homeserver/pub/a.json");
    expect(sent.method).toBe("PUT");
    expect(sent.headers.get("authorization")).toBe("Bearer token");
    expect(sent.credentials).toBe("include");
    expect(await sent.text()).toBe('{"name":"Alice"}');
  });

  it("passes everything else through untouched, and installs once per scope", async () => {
    const target = scope();
    const original = target.fetch;
    installUrlRewrites(target, REWRITES);
    const wrapped = target.fetch;
    installUrlRewrites(target, REWRITES);
    expect(target.fetch).toBe(wrapped);
    const request = new Request("https://homegate.example/sms_verification/info");
    await target.fetch(request);
    await target.fetch("http://localhost:6287/pub/x");
    expect(target.calls).toEqual([
      [request, undefined],
      ["http://localhost:6287/pub/x", undefined],
    ]);
    expect(wrapped).not.toBe(original);
    // Without rules nothing is wrapped.
    const untouched = scope();
    const before = untouched.fetch;
    installUrlRewrites(untouched, []);
    expect(untouched.fetch).toBe(before);
  });
});

describe("configurePubkyNetwork", () => {
  it("is mainnet until configured, and installs a testnet's rewrites on the page", async () => {
    expect(pubkyNetwork()).toBe(MAINNET);
    const fetch = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetch);
    try {
      const testnet = {
        network: "testnet" as const,
        pkarrRelays: ["https://gateway.example/_pubky/pkarr"],
        rewrites: REWRITES,
      };
      configurePubkyNetwork(testnet);
      expect(pubkyNetwork()).toBe(testnet);
      await window.fetch("http://localhost:6286/pub/x");
      expect(fetch).toHaveBeenCalledWith(
        "https://gateway.example/_pubky/homeserver/pub/x",
        undefined,
      );
    } finally {
      configurePubkyNetwork(MAINNET);
      vi.unstubAllGlobals();
    }
  });
});
