/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PassportProviderConfiguration } from "@/client/ui/passportProviderConfiguration";
import { MAINNET } from "@/libs/pubkyNetwork";
import { makeInstanceConfig } from "@test-utils/instanceConfig";
import { InvalidAuthorization } from "./invalidAuthorization";

const TESTNET = {
  network: "testnet" as const,
  pkarrRelays: ["https://gateway.example/_pubky/pkarr"],
  rewrites: [],
};

describe("InvalidAuthorization for another network", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    [
      MAINNET,
      "This app signs in on the Pubky testnet, and this Passport works on the main network.",
    ],
    [
      TESTNET,
      "This app signs in on the Pubky main network, and this Passport works on the testnet.",
    ],
  ])("names both networks from this instance's (%#)", (network, cause) => {
    vi.stubGlobal("opener", null);
    render(
      <PassportProviderConfiguration value={makeInstanceConfig({ network })}>
        <InvalidAuthorization reason="network_mismatch" />
      </PassportProviderConfiguration>,
    );
    expect(screen.getByRole("heading", { name: "Different network." })).toHaveAccessibleDescription(
      new RegExp(`^${cause.replaceAll(".", "\\.")}`, "u"),
    );
    expect(screen.getByText(/sign in with a Passport on its network/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();
  });
});
