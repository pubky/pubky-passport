/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";

import { PUBKY_NETWORK_META_NAME, readPageNetwork, rewriteUrl } from "./pubkyNetwork";

const REWRITES = [
  { from: "http://localhost:6286", to: "https://gateway.example/_pubky/homeserver" },
  { from: "https://app.example/_pubky/relay", to: "https://gateway.example/_pubky/relay" },
  { from: "https://app.example/_pubky/relay/inbox", to: "https://inbox.example" },
];

describe("rewriteUrl", () => {
  it.each([
    ["http://localhost:6286/", "https://gateway.example/_pubky/homeserver/"],
    [
      "http://localhost:6286/pub/pubky.app/profile.json?x=1",
      "https://gateway.example/_pubky/homeserver/pub/pubky.app/profile.json?x=1",
    ],
    ["https://app.example/_pubky/relay/link/abc", "https://gateway.example/_pubky/relay/link/abc"],
    // The longest matching prefix wins.
    ["https://app.example/_pubky/relay/inbox/abc", "https://inbox.example/abc"],
    ["https://app.example/_pubky/relay", "https://gateway.example/_pubky/relay"],
  ])("sends %s to %s", (url, target) => {
    expect(rewriteUrl(url, REWRITES)).toBe(target);
  });

  it.each([
    "http://localhost:6287/pub/x",
    "https://localhost:6286/pub/x",
    "https://app.example/_pubky/relayx/abc",
    "https://app.example/_pubky",
    "https://other.example/_pubky/relay/link/abc",
  ])("leaves %s alone: a prefix matches only at a path boundary", (url) => {
    expect(rewriteUrl(url, REWRITES)).toBeUndefined();
  });

  it("rewrites nothing without rules", () => {
    expect(rewriteUrl("http://localhost:6286/pub/x", [])).toBeUndefined();
  });
});

describe("readPageNetwork", () => {
  afterEach(() => document.head.replaceChildren());

  it.each([
    ["testnet", "testnet"],
    ["mainnet", "mainnet"],
    ["devnet", "mainnet"],
    ["", "mainnet"],
  ])("reads %j from the layout's meta as %s", (content, network) => {
    const meta = document.createElement("meta");
    meta.name = PUBKY_NETWORK_META_NAME;
    meta.content = content;
    document.head.append(meta);
    expect(readPageNetwork(document)).toBe(network);
  });

  it("is mainnet without the meta, or when the document cannot be read", () => {
    expect(readPageNetwork(document)).toBe("mainnet");
    expect(
      readPageNetwork({
        querySelector: () => {
          throw new Error("detached");
        },
      }),
    ).toBe("mainnet");
  });
});
