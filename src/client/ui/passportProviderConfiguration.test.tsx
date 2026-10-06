/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { configurePubkyNetwork, pubkyNetwork } from "@/client/logic/pubky/pubkyNetwork";
import { MAINNET } from "@/libs/pubkyNetwork";
import { makeInstanceConfig } from "@test-utils/instanceConfig";
import {
  PassportProviderConfiguration,
  ProviderTerms,
  usePassportProvider,
} from "./passportProviderConfiguration";

function ProviderProbe() {
  const provider = usePassportProvider();
  return (
    <output>
      {provider.verificationMethods.join(",")}|{String(provider.features.google)}|
      {provider.homeserver ?? "none"}
    </output>
  );
}

describe("PassportProviderConfiguration", () => {
  afterEach(cleanup);

  it("makes the server-rendered instance configuration available to client consumers", () => {
    render(
      <PassportProviderConfiguration
        value={makeInstanceConfig({
          verificationMethods: ["invite"],
          features: { google: false },
          homeserver: null,
        })}
      >
        <ProviderProbe />
      </PassportProviderConfiguration>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("invite|false|none");
  });

  it("sets the SDK's network before anything below renders", () => {
    const testnet = {
      network: "testnet" as const,
      pkarrRelays: ["https://gateway.example/_pubky/pkarr"],
      rewrites: [],
    };
    let seen: unknown;
    function NetworkProbe() {
      seen = pubkyNetwork();
      return null;
    }
    try {
      render(
        <PassportProviderConfiguration value={makeInstanceConfig({ network: testnet })}>
          <NetworkProbe />
        </PassportProviderConfiguration>,
      );
      expect(seen).toBe(testnet);
    } finally {
      configurePubkyNetwork(MAINNET);
    }
  });

  it("fails instead of assuming every feature when rendered outside the layout", () => {
    expect(() => render(<ProviderProbe />)).toThrow(
      "Passport provider configuration is unavailable.",
    );
  });

  it("links the provider's terms and privacy policy, named apart from Passport's own", () => {
    render(
      <PassportProviderConfiguration
        value={makeInstanceConfig({
          termsUrl: "https://acme.example/terms",
          privacyUrl: "https://acme.example/privacy",
        })}
      >
        <ProviderTerms />
      </PassportProviderConfiguration>,
    );

    const terms = screen.getByRole("link", {
      name: "Terms of Service of the homeserver provider (opens in a new tab)",
    });
    const privacy = screen.getByRole("link", {
      name: "Privacy Policy of the homeserver provider (opens in a new tab)",
    });
    expect(terms).toHaveAttribute("href", "https://acme.example/terms");
    expect(privacy).toHaveAttribute("href", "https://acme.example/privacy");
    for (const link of [terms, privacy]) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      // Underlined at rest: colour alone does not mark a link inside a sentence.
      expect(link).toHaveClass("underline");
    }
    expect(screen.getByText(/^Homeserver provider:/u)).toBeInTheDocument();
  });
});
