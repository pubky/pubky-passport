import { Pubky } from "@synonymdev/pubky";
import { afterEach, expect, it, vi } from "vitest";

import { MAINNET } from "@/libs/pubkyNetwork";
import { configurePubkyNetwork } from "./pubkyNetwork";
import { PubkySdkAdapter } from "./PubkySdkAdapter";

afterEach(() => {
  configurePubkyNetwork(MAINNET);
  vi.restoreAllMocks();
});

it("builds mainnet facades with the SDK's defaults", () => {
  const withClient = vi.spyOn(Pubky, "withClient");
  const adapter = new PubkySdkAdapter();
  adapter.dispose();
  expect(withClient).not.toHaveBeenCalled();
});

it("builds a testnet's facades on its own PKARR relays", () => {
  const withClient = vi.spyOn(Pubky, "withClient");
  configurePubkyNetwork({
    network: "testnet",
    pkarrRelays: ["https://gateway.example/_pubky/pkarr", "http://localhost:15411"],
    rewrites: [],
  });
  const adapter = new PubkySdkAdapter();
  adapter.dispose();
  expect(withClient).toHaveBeenCalledOnce();
});
